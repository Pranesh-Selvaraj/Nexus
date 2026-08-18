import { TRPCError } from '@trpc/server';
import { observable } from '@trpc/server/observable';
import { and, asc, desc, eq, sql } from 'drizzle-orm';

import type { ChatEvent, Source } from '@nexus/shared-types';
import {
  chatStreamInputSchema,
  conversationIdSchema,
  workspaceIdSchema,
} from '@nexus/shared-types';

import { db } from '../db/index.js';
import { conversations, messages, workspaces } from '../db/schema.js';
import { protectedProcedure, t } from '../middleware/auth.js';
import { hybridRetrieveChunks, streamAnswer } from '../services/llm.service.js';

function toConversationDTO(row: {
  id: string;
  workspaceId: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
  message_count: number;
}) {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    title: row.title,
    messageCount: Number(row.message_count),
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
  };
}

/**
 * Ensures the conversation exists and belongs to the authenticated user
 * (mirrors assertWorkspaceOwnership in document.router.ts). Joins through
 * workspaces so ownership is derived from the workspace, not duplicated on
 * the conversation row.
 */
async function assertConversationOwnership(
  userId: string,
  conversationId: string,
): Promise<void> {
  const [row] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .innerJoin(workspaces, eq(workspaces.id, conversations.workspaceId))
    .where(
      and(eq(conversations.id, conversationId), eq(workspaces.userId, userId)),
    )
    .limit(1);
  if (!row) {
    throw new TRPCError({
      code: 'NOT_FOUND',
      message: 'Conversation not found',
    });
  }
}

export const chatRouter = t.router({
  /** Conversations for a workspace, most recently active first. */
  listByWorkspace: protectedProcedure
    .input(workspaceIdSchema)
    .query(async ({ ctx, input }) => {
      const [workspace] = await db
        .select({ id: workspaces.id })
        .from(workspaces)
        .where(
          and(
            eq(workspaces.id, input.workspaceId),
            eq(workspaces.userId, ctx.user.id),
          ),
        )
        .limit(1);
      if (!workspace) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Workspace not found',
        });
      }

      const result = await db
        .select({
          id: conversations.id,
          workspaceId: conversations.workspaceId,
          title: conversations.title,
          createdAt: conversations.createdAt,
          updatedAt: conversations.updatedAt,
          message_count: sql<number>`(
            SELECT COUNT(*)::int FROM messages m
            WHERE m.conversation_id = conversations.id
          )`,
        })
        .from(conversations)
        .where(eq(conversations.workspaceId, input.workspaceId))
        .orderBy(desc(conversations.updatedAt));
      return result.map(toConversationDTO);
    }),

  /** Full message history of a conversation (oldest first). */
  messages: protectedProcedure
    .input(conversationIdSchema)
    .query(async ({ ctx, input }) => {
      await assertConversationOwnership(ctx.user.id, input.conversationId);
      const rows = await db
        .select()
        .from(messages)
        .where(eq(messages.conversationId, input.conversationId))
        .orderBy(asc(messages.createdAt), asc(messages.id));
      return rows.map((m) => ({
        id: m.id,
        conversationId: m.conversationId,
        role: m.role,
        content: m.content,
        sources: m.sources,
        usage: m.usage,
        createdAt: new Date(m.createdAt).toISOString(),
      }));
    }),

  delete: protectedProcedure
    .input(conversationIdSchema)
    .mutation(async ({ ctx, input }): Promise<{ deleted: boolean }> => {
      await assertConversationOwnership(ctx.user.id, input.conversationId);
      const [deleted] = await db
        .delete(conversations)
        .where(eq(conversations.id, input.conversationId))
        .returning({ id: conversations.id });
      if (!deleted) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Conversation not found',
        });
      }
      return { deleted: true };
    }),

  /**
   * Streaming RAG chat with persistence. Every exchange is stored:
   * the user message is inserted before the stream starts and the
   * assistant reply (with its sources) after it finishes.
   *
   * Event protocol:
   *   { type: 'conversation', conversationId } -> persisted conversation
   *   { type: 'sources', sources }  -> retrieval results, pre-stream
   *   { type: 'token', token }      -> incremental LLM output
   *   { type: 'done', sources }     -> completion (final citations)
   *   { type: 'error', message }    -> terminal failure
   */
  stream: protectedProcedure
    .input(chatStreamInputSchema)
    .subscription(({ ctx, input }) =>
      observable<ChatEvent>((emit) => {
        let cancelled = false;

        const run = async (): Promise<void> => {
          let conversation = input.conversationId ?? null;
          try {
            const [workspace] = await db
              .select({ id: workspaces.id })
              .from(workspaces)
              .where(
                and(
                  eq(workspaces.id, input.workspaceId),
                  eq(workspaces.userId, ctx.user.id),
                ),
              )
              .limit(1);
            if (!workspace) {
              throw new TRPCError({
                code: 'NOT_FOUND',
                message: 'Workspace not found',
              });
            }

            // Start (or reuse) a conversation and store the user message.
            if (!conversation) {
              const [created] = await db
                .insert(conversations)
                .values({
                  workspaceId: input.workspaceId,
                  title:
                    input.message.trim().length > 48
                      ? `${input.message.trim().slice(0, 48)}…`
                      : input.message.trim(),
                })
                .returning();
              conversation = created?.id ?? null;
            }
            if (!conversation) {
              throw new TRPCError({
                code: 'INTERNAL_SERVER_ERROR',
                message: 'Failed to create conversation',
              });
            }
            await db.insert(messages).values({
              conversationId: conversation,
              role: 'user',
              content: input.message,
            });
            if (cancelled) return;
            emit.next({ type: 'conversation', conversationId: conversation });

            const sources = await hybridRetrieveChunks(
              input.workspaceId,
              input.message,
            );
            if (cancelled) return;
            emit.next({ type: 'sources', sources });

            const stream = await streamAnswer({
              query: input.message,
              history: input.history,
              sources,
            });

            let answer = '';
            // Populated when the provider supports stream usage (OpenAI does
            // with stream_options.include_usage; compatible providers may not).
            let usage: {
              promptTokens: number;
              completionTokens: number;
              totalTokens: number;
            } | null = null;
            for await (const chunk of stream) {
              if (cancelled) return;
              const token = chunk.choices[0]?.delta?.content;
              if (token) {
                answer += token;
                emit.next({ type: 'token', token });
              }
              if (chunk.usage) {
                usage = {
                  promptTokens: chunk.usage.prompt_tokens,
                  completionTokens: chunk.usage.completion_tokens,
                  totalTokens: chunk.usage.total_tokens,
                };
              }
            }
            if (cancelled) return;

            await persistAssistantMessage(conversation, answer, sources, usage);
            emit.next({ type: 'done', sources });
          } catch (error) {
            if (cancelled) return;
            const message =
              error instanceof Error ? error.message : 'Unknown error occurred';
            if (conversation) {
              await persistAssistantMessage(conversation, message, []).catch(
                () => undefined,
              );
            }
            emit.next({ type: 'error', message });
          } finally {
            // The observable may already be closed (client disconnected) -
            // completing again throws ERR_INVALID_STATE and would crash the
            // process.
            if (!cancelled) {
              try {
                emit.complete();
              } catch {
                // already closed - nothing to do
              }
            }
          }
        };

        void run();
        return () => {
          cancelled = true;
        };
      }),
    ),
});

async function persistAssistantMessage(
  conversationId: string,
  content: string,
  sources: Source[],
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  } | null = null,
): Promise<void> {
  await db
    .update(conversations)
    .set({ updatedAt: new Date() })
    .where(eq(conversations.id, conversationId));
  await db.insert(messages).values({
    conversationId,
    role: 'assistant',
    content,
    sources: sources.length > 0 ? sources : null,
    usage,
  });
}

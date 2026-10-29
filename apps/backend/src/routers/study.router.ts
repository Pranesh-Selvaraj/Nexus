import { TRPCError } from '@trpc/server';
import { and, desc, eq, getTableColumns, sql } from 'drizzle-orm';

import type {
  DeckDTO,
  DueCard,
  FlashcardDTO,
  StudyProgress,
} from '@nexus/shared-types';
import {
  cardIdSchema,
  createCardInputSchema,
  createDeckInputSchema,
  deckIdSchema,
  dueCardsInputSchema,
  generateCardsInputSchema,
  reviewCardInputSchema,
  updateCardInputSchema,
  workspaceIdSchema,
} from '@nexus/shared-types';

import { db } from '../db/index.js';
import { workspaceAccessPredicate } from '../services/access.service.js';
import { ApiError } from '../utils/errors.js';
import { decks, flashcards, workspaces } from '../db/schema.js';
import { protectedProcedure, t } from '../middleware/auth.js';
import { assertWorkspaceAccessTrpc } from '../middleware/access.js';
import { getOrCreateDefaultDeck } from '../services/deck.service.js';
import { computeStreak, emptySchedule } from '../services/fsrs.service.js';
import { loadDocumentText } from '../services/source-text.service.js';
import {
  listDueCards,
  submitCardReview,
  toCardDTO,
} from '../services/review.service.js';
import { generateCardsFromText } from '../services/study.service.js';

async function assertWorkspaceOwnership(
  userId: string,
  workspaceId: string,
  minRole: 'reader' | 'editor' | 'owner' = 'reader',
): Promise<void> {
  await assertWorkspaceAccessTrpc(userId, workspaceId, minRole);
}

export const studyRouter = t.router({
  /** Dashboard numbers for a workspace. */
  progress: protectedProcedure
    .input(workspaceIdSchema)
    .query(async ({ ctx, input }): Promise<StudyProgress> => {
      await assertWorkspaceOwnership(ctx.user.id, input.workspaceId);

      const cardResult = await db.execute(
        sql`
          SELECT
            COUNT(*)::int AS total_cards,
            COUNT(*) FILTER (WHERE NOT c.suspended AND c.due_at <= now())::int AS due_now,
            COUNT(*) FILTER (WHERE NOT c.suspended AND c.state = 0)::int AS new_cards,
            COUNT(*) FILTER (WHERE c.created_at >= now() - interval '7 days')::int AS cards_added_7d
          FROM flashcards c
          JOIN decks d ON d.id = c.deck_id
          WHERE d.workspace_id = ${input.workspaceId}
        `,
      );
      const cardRow = (
        cardResult as unknown as {
          rows: Array<{
            total_cards: number;
            due_now: number;
            new_cards: number;
            cards_added_7d: number;
          }>;
        }
      ).rows[0];

      const reviewResult = await db.execute(
        sql`
          SELECT
            COUNT(*) FILTER (WHERE r.reviewed_at >= date_trunc('day', now()))::int AS reviews_today,
            AVG(CASE WHEN r.rating >= 3 THEN 1.0 ELSE 0.0 END)
              FILTER (WHERE r.reviewed_at >= now() - interval '30 days') AS retention
          FROM card_reviews r
          JOIN flashcards c ON c.id = r.card_id
          JOIN decks d ON d.id = c.deck_id
          WHERE d.workspace_id = ${input.workspaceId}
        `,
      );
      const reviewRow = (
        reviewResult as unknown as {
          rows: Array<{
            reviews_today: number;
            retention: string | number | null;
          }>;
        }
      ).rows[0];

      const daysResult = await db.execute(
        sql`
          SELECT DISTINCT
            to_char(r.reviewed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day
          FROM card_reviews r
          JOIN flashcards c ON c.id = r.card_id
          JOIN decks d ON d.id = c.deck_id
          WHERE d.workspace_id = ${input.workspaceId}
            AND r.reviewed_at >= now() - interval '90 days'
          ORDER BY day DESC
        `,
      );
      const days = (
        daysResult as unknown as { rows: Array<{ day: string }> }
      ).rows.map((row) => row.day);

      const retention =
        reviewRow?.retention == null ? null : Number(reviewRow.retention);

      return {
        totalCards: Number(cardRow?.total_cards ?? 0),
        dueNow: Number(cardRow?.due_now ?? 0),
        newCards: Number(cardRow?.new_cards ?? 0),
        reviewsToday: Number(reviewRow?.reviews_today ?? 0),
        streakDays: computeStreak(days),
        retention30d:
          retention == null || Number.isNaN(retention)
            ? null
            : Math.min(1, Math.max(0, retention)),
        cardsAdded7d: Number(cardRow?.cards_added_7d ?? 0),
      };
    }),

  decks: t.router({
    list: protectedProcedure
      .input(workspaceIdSchema)
      .query(async ({ ctx, input }): Promise<DeckDTO[]> => {
        await assertWorkspaceOwnership(ctx.user.id, input.workspaceId);
        const result = await db.execute(
          sql`
            SELECT d.id, d.workspace_id, d.name, d.created_at,
              COUNT(c.id)::int AS card_count,
              COUNT(c.id) FILTER (WHERE NOT c.suspended AND c.due_at <= now())::int AS due_count,
              COUNT(c.id) FILTER (WHERE NOT c.suspended AND c.state = 0)::int AS new_count
            FROM decks d
            LEFT JOIN flashcards c ON c.deck_id = d.id
            WHERE d.workspace_id = ${input.workspaceId}
            GROUP BY d.id
            ORDER BY d.created_at ASC
          `,
        );
        const rows = (
          result as unknown as {
            rows: Array<{
              id: string;
              workspace_id: string;
              name: string;
              created_at: Date;
              card_count: number;
              due_count: number;
              new_count: number;
            }>;
          }
        ).rows;
        return rows.map((row) => ({
          id: row.id,
          workspaceId: row.workspace_id,
          name: row.name,
          cardCount: Number(row.card_count),
          dueCount: Number(row.due_count),
          newCount: Number(row.new_count),
          createdAt: new Date(row.created_at).toISOString(),
        }));
      }),

    create: protectedProcedure
      .input(createDeckInputSchema)
      .mutation(async ({ ctx, input }): Promise<DeckDTO> => {
        await assertWorkspaceOwnership(
          ctx.user.id,
          input.workspaceId,
          'editor',
        );
        const [created] = await db
          .insert(decks)
          .values({ workspaceId: input.workspaceId, name: input.name })
          .returning();
        if (!created) {
          throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
        }
        return {
          id: created.id,
          workspaceId: created.workspaceId,
          name: created.name,
          cardCount: 0,
          dueCount: 0,
          newCount: 0,
          createdAt: new Date(created.createdAt).toISOString(),
        };
      }),

    rename: protectedProcedure
      .input(deckIdSchema.extend({ name: createDeckInputSchema.shape.name }))
      .mutation(async ({ ctx, input }): Promise<{ renamed: boolean }> => {
        const [deck] = await db
          .select({ id: decks.id, workspaceId: decks.workspaceId })
          .from(decks)
          .innerJoin(workspaces, eq(workspaces.id, decks.workspaceId))
          .where(
            and(
              eq(decks.id, input.deckId),
              workspaceAccessPredicate(ctx.user.id),
            ),
          )
          .limit(1);
        if (!deck) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Deck not found' });
        }
        await assertWorkspaceOwnership(ctx.user.id, deck.workspaceId, 'editor');
        await db
          .update(decks)
          .set({ name: input.name })
          .where(eq(decks.id, deck.id));
        return { renamed: true };
      }),

    delete: protectedProcedure
      .input(deckIdSchema)
      .mutation(async ({ ctx, input }): Promise<{ deleted: boolean }> => {
        const [deck] = await db
          .select({ id: decks.id, workspaceId: decks.workspaceId })
          .from(decks)
          .innerJoin(workspaces, eq(workspaces.id, decks.workspaceId))
          .where(
            and(
              eq(decks.id, input.deckId),
              workspaceAccessPredicate(ctx.user.id),
            ),
          )
          .limit(1);
        if (!deck) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Deck not found' });
        }
        await assertWorkspaceOwnership(ctx.user.id, deck.workspaceId, 'editor');
        await db.delete(decks).where(eq(decks.id, deck.id));
        return { deleted: true };
      }),
  }),

  cards: t.router({
    /** Due cards (workspace-wide or one deck) with rating interval previews. */
    due: protectedProcedure
      .input(dueCardsInputSchema)
      .query(async ({ ctx, input }): Promise<DueCard[]> => {
        return listDueCards({
          userId: ctx.user.id,
          workspaceId: input.workspaceId,
          deckId: input.deckId,
          limit: input.limit,
        }).catch((err: unknown) => {
          if (err instanceof ApiError) {
            throw new TRPCError({
              code: err.status === 404 ? 'NOT_FOUND' : 'BAD_REQUEST',
              message: err.message,
            });
          }
          throw err;
        });
      }),

    /** Submit one review rating and schedule the next occurrence. */
    review: protectedProcedure
      .input(reviewCardInputSchema)
      .mutation(
        async ({
          ctx,
          input,
        }): Promise<{ nextDueAt: string; remaining: number }> => {
          return submitCardReview({
            userId: ctx.user.id,
            cardId: input.cardId,
            rating: input.rating,
            durationMs: input.durationMs,
          }).catch((err: unknown) => {
            if (err instanceof ApiError) {
              throw new TRPCError({
                code: err.status === 404 ? 'NOT_FOUND' : 'BAD_REQUEST',
                message: err.message,
              });
            }
            throw err;
          });
        },
      ),

    create: protectedProcedure
      .input(createCardInputSchema)
      .mutation(async ({ ctx, input }): Promise<FlashcardDTO> => {
        const [deck] = await db
          .select({ id: decks.id })
          .from(decks)
          .innerJoin(workspaces, eq(workspaces.id, decks.workspaceId))
          .where(
            and(
              eq(decks.id, input.deckId),
              workspaceAccessPredicate(ctx.user.id),
            ),
          )
          .limit(1);
        if (!deck) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Deck not found' });
        }
        const schedule = emptySchedule();
        const [created] = await db
          .insert(flashcards)
          .values({
            deckId: deck.id,
            kind: input.kind ?? 'qa',
            front: input.front,
            back: input.back,
            sourceChunkId: input.sourceChunkId ?? null,
            sourceMessageId: input.sourceMessageId ?? null,
            ...schedule,
          })
          .returning();
        if (!created) {
          throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
        }
        return toCardDTO(created);
      }),

    update: protectedProcedure
      .input(updateCardInputSchema)
      .mutation(async ({ ctx, input }): Promise<FlashcardDTO> => {
        const [row] = await db
          .select({
            ...getTableColumns(flashcards),
            workspaceId: decks.workspaceId,
          })
          .from(flashcards)
          .innerJoin(decks, eq(decks.id, flashcards.deckId))
          .innerJoin(workspaces, eq(workspaces.id, decks.workspaceId))
          .where(
            and(
              eq(flashcards.id, input.cardId),
              workspaceAccessPredicate(ctx.user.id),
            ),
          )
          .limit(1);
        if (!row) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Card not found' });
        }
        await assertWorkspaceOwnership(ctx.user.id, row.workspaceId, 'editor');
        const [updated] = await db
          .update(flashcards)
          .set({
            front: input.front ?? row.front,
            back: input.back ?? row.back,
            suspended: input.suspended ?? row.suspended,
          })
          .where(eq(flashcards.id, row.id))
          .returning();
        if (!updated) {
          throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
        }
        return toCardDTO(updated);
      }),

    delete: protectedProcedure
      .input(cardIdSchema)
      .mutation(async ({ ctx, input }): Promise<{ deleted: boolean }> => {
        const [row] = await db
          .select({ id: flashcards.id, workspaceId: decks.workspaceId })
          .from(flashcards)
          .innerJoin(decks, eq(decks.id, flashcards.deckId))
          .innerJoin(workspaces, eq(workspaces.id, decks.workspaceId))
          .where(
            and(
              eq(flashcards.id, input.cardId),
              workspaceAccessPredicate(ctx.user.id),
            ),
          )
          .limit(1);
        if (!row) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Card not found' });
        }
        await assertWorkspaceOwnership(ctx.user.id, row.workspaceId, 'editor');
        await db.delete(flashcards).where(eq(flashcards.id, row.id));
        return { deleted: true };
      }),

    /** Generate cards from a document or a text selection. */
    generate: protectedProcedure
      .input(generateCardsInputSchema)
      .mutation(
        async ({
          ctx,
          input,
        }): Promise<{ deckId: string; created: FlashcardDTO[] }> => {
          await assertWorkspaceOwnership(
            ctx.user.id,
            input.workspaceId,
            'editor',
          );

          const sourceText = input.documentId
            ? await loadDocumentText(input.workspaceId, input.documentId)
            : (input.text ?? '');

          const generated = await generateCardsFromText(
            sourceText,
            input.count,
          );
          if (generated.length === 0) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message:
                'Could not generate flashcards from this material. Try a longer passage or a different model.',
            });
          }

          let deckId = input.deckId ?? null;
          if (deckId) {
            const [deck] = await db
              .select({ id: decks.id })
              .from(decks)
              .where(
                and(
                  eq(decks.id, deckId),
                  eq(decks.workspaceId, input.workspaceId),
                ),
              )
              .limit(1);
            if (!deck) {
              throw new TRPCError({
                code: 'NOT_FOUND',
                message: 'Deck not found',
              });
            }
          } else {
            deckId = await getOrCreateDefaultDeck(input.workspaceId);
          }

          const created: FlashcardDTO[] = [];
          for (const card of generated) {
            const [row] = await db
              .insert(flashcards)
              .values({
                deckId,
                kind: 'qa',
                front: card.front,
                back: card.back,
                ...emptySchedule(),
              })
              .returning();
            if (row) created.push(toCardDTO(row));
          }

          return { deckId, created };
        },
      ),

    /** CSV export of a deck (or the whole workspace) for Anki import. */
    exportCsv: protectedProcedure
      .input(
        workspaceIdSchema.extend({
          deckId: deckIdSchema.shape.deckId.optional(),
        }),
      )
      .query(
        async ({ ctx, input }): Promise<{ filename: string; csv: string }> => {
          await assertWorkspaceOwnership(ctx.user.id, input.workspaceId);
          const conditions = [eq(decks.workspaceId, input.workspaceId)];
          if (input.deckId)
            conditions.push(eq(flashcards.deckId, input.deckId));
          const rows = await db
            .select({ front: flashcards.front, back: flashcards.back })
            .from(flashcards)
            .innerJoin(decks, eq(decks.id, flashcards.deckId))
            .where(and(...conditions))
            .orderBy(desc(flashcards.createdAt))
            .limit(5000);

          const escape = (value: string): string =>
            `"${value.replace(/"/g, '""')}"`;
          const csv = [
            'front,back',
            ...rows.map((row) => `${escape(row.front)},${escape(row.back)}`),
          ].join('\n');

          return { filename: 'nexus-flashcards.csv', csv };
        },
      ),
  }),
});

import { TRPCError } from '@trpc/server';
import { and, asc, desc, eq, getTableColumns, lte, sql } from 'drizzle-orm';

import type {
  DeckDTO,
  DueCard,
  FlashcardDTO,
  ReviewRating,
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
import {
  cardReviews,
  decks,
  documents,
  flashcards,
  progressEvents,
  workspaces,
} from '../db/schema.js';
import { protectedProcedure, t } from '../middleware/auth.js';
import {
  computeStreak,
  emptySchedule,
  previewIntervals,
  scheduleReview,
} from '../services/fsrs.service.js';
import type { FlashcardSchedule } from '../services/fsrs.service.js';
import { generateCardsFromText } from '../services/study.service.js';

const RATING_VALUE: Record<ReviewRating, number> = {
  again: 1,
  hard: 2,
  good: 3,
  easy: 4,
};

type CardRow = typeof flashcards.$inferSelect;

async function assertWorkspaceOwnership(
  userId: string,
  workspaceId: string,
): Promise<void> {
  const [workspace] = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(and(eq(workspaces.id, workspaceId), eq(workspaces.userId, userId)))
    .limit(1);
  if (!workspace) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Workspace not found' });
  }
}

function scheduleFromRow(row: CardRow): FlashcardSchedule {
  return {
    dueAt: row.dueAt,
    stability: row.stability,
    difficulty: row.difficulty,
    elapsedDays: row.elapsedDays,
    scheduledDays: row.scheduledDays,
    learningSteps: row.learningSteps,
    reps: row.reps,
    lapses: row.lapses,
    state: row.state,
    lastReviewAt: row.lastReviewAt,
  };
}

function toCardDTO(row: CardRow): FlashcardDTO {
  return {
    id: row.id,
    deckId: row.deckId,
    kind: row.kind === 'cloze' ? 'cloze' : 'qa',
    front: row.front,
    back: row.back,
    dueAt: new Date(row.dueAt).toISOString(),
    state: row.state,
    reps: row.reps,
    lapses: row.lapses,
    suspended: row.suspended,
    createdAt: new Date(row.createdAt).toISOString(),
  };
}

/** The workspace's default deck, created on first use. */
async function getOrCreateDefaultDeck(workspaceId: string): Promise<string> {
  const [existing] = await db
    .select({ id: decks.id })
    .from(decks)
    .where(eq(decks.workspaceId, workspaceId))
    .orderBy(asc(decks.createdAt))
    .limit(1);
  if (existing) return existing.id;

  const [created] = await db
    .insert(decks)
    .values({ workspaceId, name: 'Study' })
    .returning({ id: decks.id });
  if (!created) {
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Failed to create the default deck',
    });
  }
  return created.id;
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
        await assertWorkspaceOwnership(ctx.user.id, input.workspaceId);
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
          .select({ id: decks.id })
          .from(decks)
          .innerJoin(workspaces, eq(workspaces.id, decks.workspaceId))
          .where(
            and(eq(decks.id, input.deckId), eq(workspaces.userId, ctx.user.id)),
          )
          .limit(1);
        if (!deck) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Deck not found' });
        }
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
          .select({ id: decks.id })
          .from(decks)
          .innerJoin(workspaces, eq(workspaces.id, decks.workspaceId))
          .where(
            and(eq(decks.id, input.deckId), eq(workspaces.userId, ctx.user.id)),
          )
          .limit(1);
        if (!deck) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Deck not found' });
        }
        await db.delete(decks).where(eq(decks.id, deck.id));
        return { deleted: true };
      }),
  }),

  cards: t.router({
    /** Due cards (workspace-wide or one deck) with rating interval previews. */
    due: protectedProcedure
      .input(dueCardsInputSchema)
      .query(async ({ ctx, input }): Promise<DueCard[]> => {
        await assertWorkspaceOwnership(ctx.user.id, input.workspaceId);
        const conditions = [
          eq(decks.workspaceId, input.workspaceId),
          eq(flashcards.suspended, false),
          lte(flashcards.dueAt, new Date()),
        ];
        if (input.deckId) conditions.push(eq(flashcards.deckId, input.deckId));

        const rows = await db
          .select({ ...getTableColumns(flashcards), deckName: decks.name })
          .from(flashcards)
          .innerJoin(decks, eq(decks.id, flashcards.deckId))
          .where(and(...conditions))
          .orderBy(asc(flashcards.dueAt), asc(flashcards.createdAt))
          .limit(input.limit);

        return rows.map((row) => ({
          ...toCardDTO(row),
          deckName: row.deckName,
          intervals: previewIntervals(scheduleFromRow(row)),
        }));
      }),

    /** Submit one review rating and schedule the next occurrence. */
    review: protectedProcedure
      .input(reviewCardInputSchema)
      .mutation(
        async ({
          ctx,
          input,
        }): Promise<{ nextDueAt: string; remaining: number }> => {
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
                eq(workspaces.userId, ctx.user.id),
              ),
            )
            .limit(1);
          if (!row) {
            throw new TRPCError({
              code: 'NOT_FOUND',
              message: 'Card not found',
            });
          }

          const next = scheduleReview(
            scheduleFromRow(row),
            input.rating,
            new Date(),
          );
          await db
            .update(flashcards)
            .set({
              dueAt: next.dueAt,
              stability: next.stability,
              difficulty: next.difficulty,
              elapsedDays: next.elapsedDays,
              scheduledDays: next.scheduledDays,
              learningSteps: next.learningSteps,
              reps: next.reps,
              lapses: next.lapses,
              state: next.state,
              lastReviewAt: next.lastReviewAt,
            })
            .where(eq(flashcards.id, row.id));

          await db.insert(cardReviews).values({
            cardId: row.id,
            rating: RATING_VALUE[input.rating],
            durationMs: input.durationMs ?? null,
          });
          await db.insert(progressEvents).values({
            userId: ctx.user.id,
            workspaceId: row.workspaceId,
            kind: 'review',
            subject: row.deckId,
            correct: input.rating !== 'again',
            durationMs: input.durationMs ?? null,
          });

          const remainingResult = await db.execute(
            sql`
              SELECT COUNT(*)::int AS remaining
              FROM flashcards c
              JOIN decks d ON d.id = c.deck_id
              WHERE d.workspace_id = ${row.workspaceId}
                AND NOT c.suspended
                AND c.due_at <= now()
            `,
          );
          const remaining = (
            remainingResult as unknown as { rows: Array<{ remaining: number }> }
          ).rows[0];

          return {
            nextDueAt: next.dueAt.toISOString(),
            remaining: Number(remaining?.remaining ?? 0),
          };
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
            and(eq(decks.id, input.deckId), eq(workspaces.userId, ctx.user.id)),
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
          .select({ ...getTableColumns(flashcards) })
          .from(flashcards)
          .innerJoin(decks, eq(decks.id, flashcards.deckId))
          .innerJoin(workspaces, eq(workspaces.id, decks.workspaceId))
          .where(
            and(
              eq(flashcards.id, input.cardId),
              eq(workspaces.userId, ctx.user.id),
            ),
          )
          .limit(1);
        if (!row) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Card not found' });
        }
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
          .select({ id: flashcards.id })
          .from(flashcards)
          .innerJoin(decks, eq(decks.id, flashcards.deckId))
          .innerJoin(workspaces, eq(workspaces.id, decks.workspaceId))
          .where(
            and(
              eq(flashcards.id, input.cardId),
              eq(workspaces.userId, ctx.user.id),
            ),
          )
          .limit(1);
        if (!row) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Card not found' });
        }
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
          await assertWorkspaceOwnership(ctx.user.id, input.workspaceId);

          let sourceText = input.text ?? '';
          if (input.documentId) {
            const [doc] = await db
              .select({ id: documents.id, title: documents.title })
              .from(documents)
              .where(
                and(
                  eq(documents.id, input.documentId),
                  eq(documents.workspaceId, input.workspaceId),
                ),
              )
              .limit(1);
            if (!doc) {
              throw new TRPCError({
                code: 'NOT_FOUND',
                message: 'Document not found',
              });
            }
            const chunkResult = await db.execute(
              sql`
              SELECT content FROM chunks
              WHERE document_id = ${doc.id}
              ORDER BY (metadata->>'chunkIndex')::int ASC
              LIMIT 25
            `,
            );
            const rowList = (
              chunkResult as unknown as { rows: Array<{ content: string }> }
            ).rows;
            if (rowList.length === 0) {
              throw new TRPCError({
                code: 'BAD_REQUEST',
                message: 'This document has no indexed content yet',
              });
            }
            sourceText = rowList
              .map((row) => row.content)
              .join('\n\n')
              .slice(0, 12000);
          }

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

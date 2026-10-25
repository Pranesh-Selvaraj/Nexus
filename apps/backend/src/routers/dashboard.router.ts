import { sql } from 'drizzle-orm';

import type {
  DashboardOverview,
  DashboardRecentDocument,
  DashboardTopic,
} from '@nexus/shared-types';

import { db } from '../db/index.js';
import { protectedProcedure, t } from '../middleware/auth.js';

interface TopicRow {
  id: string;
  name: string;
  description: string | null;
  document_count: number;
  due_count: number;
  processing_count: number;
  last_activity: Date | null;
}

interface RecentRow {
  id: string;
  workspace_id: string;
  workspace_name: string;
  title: string;
  file_type: string | null;
  status: DashboardRecentDocument['status'];
  created_at: Date;
}

/**
 * The universal dashboard (learning portal): one aggregate view across every
 * topic the user owns, so the app opens with "what should I learn next?"
 * instead of an empty chat.
 */
export const dashboardRouter = t.router({
  overview: protectedProcedure.query(
    async ({ ctx }): Promise<DashboardOverview> => {
      const topicsResult = await db.execute(
        sql`
          SELECT w.id, w.name, w.description,
            COUNT(d.id) FILTER (WHERE d.status <> 'deleted')::int AS document_count,
            COUNT(d.id) FILTER (WHERE d.status = 'processing')::int AS processing_count,
            (
              SELECT COUNT(*)::int
              FROM flashcards c
              JOIN decks ck ON ck.id = c.deck_id
              WHERE ck.workspace_id = w.id
                AND NOT c.suspended
                AND c.due_at <= now()
            ) AS due_count,
            MAX(d.updated_at) AS last_activity
          FROM workspaces w
          LEFT JOIN documents d ON d.workspace_id = w.id
          WHERE w.user_id = ${ctx.user.id}
          GROUP BY w.id, w.name, w.description
          ORDER BY MAX(d.updated_at) DESC NULLS LAST, w.created_at DESC
        `,
      );
      const topicRows = (topicsResult as unknown as { rows: TopicRow[] }).rows;

      const topics: DashboardTopic[] = topicRows.map((row) => ({
        id: row.id,
        name: row.name,
        description: row.description,
        documentCount: Number(row.document_count),
        dueCount: Number(row.due_count),
        processingCount: Number(row.processing_count),
        lastActivityAt: row.last_activity
          ? new Date(row.last_activity).toISOString()
          : null,
      }));

      const recentResult = await db.execute(
        sql`
          SELECT d.id, d.workspace_id, w.name AS workspace_name, d.title,
                 d.file_type, d.status, d.created_at
          FROM documents d
          JOIN workspaces w ON w.id = d.workspace_id
          WHERE w.user_id = ${ctx.user.id}
            AND d.status <> 'deleted'
          ORDER BY d.created_at DESC
          LIMIT 6
        `,
      );
      const recentDocuments: DashboardRecentDocument[] = (
        recentResult as unknown as { rows: RecentRow[] }
      ).rows.map((row) => ({
        id: row.id,
        workspaceId: row.workspace_id,
        workspaceName: row.workspace_name,
        title: row.title,
        fileType: row.file_type,
        status: row.status,
        createdAt: new Date(row.created_at).toISOString(),
      }));

      const reviewsResult = await db.execute(
        sql`
          SELECT COUNT(*)::int AS reviews_today
          FROM card_reviews r
          JOIN flashcards c ON c.id = r.card_id
          JOIN decks d ON d.id = c.deck_id
          JOIN workspaces w ON w.id = d.workspace_id
          WHERE w.user_id = ${ctx.user.id}
            AND r.reviewed_at >= date_trunc('day', now())
        `,
      );
      const reviewsToday = Number(
        (reviewsResult as unknown as { rows: Array<{ reviews_today: number }> })
          .rows[0]?.reviews_today ?? 0,
      );

      const wordsResult = await db.execute(
        sql`
          SELECT COALESCE(SUM((d.metadata->>'wordCount')::bigint), 0)::bigint AS words
          FROM documents d
          JOIN workspaces w ON w.id = d.workspace_id
          WHERE w.user_id = ${ctx.user.id}
            AND d.status <> 'deleted'
        `,
      );
      const wordsIngested = Number(
        (wordsResult as unknown as { rows: Array<{ words: string }> }).rows[0]
          ?.words ?? 0,
      );

      return {
        totals: {
          topics: topics.length,
          documents: topics.reduce(
            (sum, topic) => sum + topic.documentCount,
            0,
          ),
          dueCards: topics.reduce((sum, topic) => sum + topic.dueCount, 0),
          reviewsToday,
          wordsIngested,
        },
        topics,
        recentDocuments,
      };
    },
  ),
});

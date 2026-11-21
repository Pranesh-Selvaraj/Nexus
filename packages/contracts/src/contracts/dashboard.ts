import { z } from 'zod';
import { documentStatusSchema } from './documents.js';

export const dashboardTopicSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  documentCount: z.number().int().nonnegative(),
  dueCount: z.number().int().nonnegative(),
  processingCount: z.number().int().nonnegative(),
  lastActivityAt: z.string().nullable(),
});
export type DashboardTopic = z.infer<typeof dashboardTopicSchema>;

export const dashboardRecentDocumentSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  workspaceName: z.string(),
  title: z.string(),
  fileType: z.string().nullable(),
  status: documentStatusSchema,
  createdAt: z.string(),
});
export type DashboardRecentDocument = z.infer<
  typeof dashboardRecentDocumentSchema
>;

export const dashboardOverviewSchema = z.object({
  totals: z.object({
    topics: z.number().int().nonnegative(),
    documents: z.number().int().nonnegative(),
    dueCards: z.number().int().nonnegative(),
    reviewsToday: z.number().int().nonnegative(),
    wordsIngested: z.number().int().nonnegative(),
  }),
  topics: z.array(dashboardTopicSchema),
  recentDocuments: z.array(dashboardRecentDocumentSchema),
});
export type DashboardOverview = z.infer<typeof dashboardOverviewSchema>;

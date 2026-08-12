import type { DocumentDTO } from '@nexus/shared-types';

import type { documents } from '../db/schema';

export function toDocumentDTO(doc: typeof documents.$inferSelect): DocumentDTO {
  return {
    id: doc.id,
    workspaceId: doc.workspaceId,
    title: doc.title,
    fileType: doc.fileType,
    status: doc.status,
    chunkCount: doc.chunkCount,
    createdAt: new Date(doc.createdAt).toISOString(),
  };
}

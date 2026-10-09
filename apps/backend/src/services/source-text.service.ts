import { TRPCError } from '@trpc/server';
import { and, eq, sql } from 'drizzle-orm';

import { db } from '../db/index.js';
import { documents } from '../db/schema.js';

/**
 * Concatenated indexed text of a document, capped for prompt use. Shared by
 * card, quiz and artifact generation so all three fail the same way when a
 * document is missing or not indexed yet.
 */
export async function loadDocumentText(
  workspaceId: string,
  documentId: string,
): Promise<string> {
  const [doc] = await db
    .select({ id: documents.id })
    .from(documents)
    .where(
      and(eq(documents.id, documentId), eq(documents.workspaceId, workspaceId)),
    )
    .limit(1);
  if (!doc) {
    throw new TRPCError({
      code: 'NOT_FOUND',
      message: 'Document not found in this workspace',
    });
  }

  const result = await db.execute(
    sql`
      SELECT content FROM chunks
      WHERE document_id = ${doc.id}
      ORDER BY (metadata->>'chunkIndex')::int ASC
      LIMIT 25
    `,
  );
  const rows = (result as unknown as { rows: Array<{ content: string }> }).rows;
  if (rows.length === 0) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'This document has no indexed content yet',
    });
  }
  return rows
    .map((row) => row.content)
    .join('\n\n')
    .slice(0, 12000);
}

import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';

import {
  analyzeImageInputSchema,
  isImageFileType,
  type AnalyzeImageResult,
  type VisionConfig,
} from '@nexus/shared-types';

import { db } from '../db/index.js';
import { documents, workspaces } from '../db/schema.js';
import { protectedProcedure, t } from '../middleware/auth.js';
import { mimeForFormat } from '../services/ingestion/magic.js';
import { ocrAvailable, ocrImage } from '../services/ingestion/ocr.js';
import {
  analyzeImage,
  toAnalyzeResult,
  visionConfig,
} from '../services/ingestion/vision.service.js';
import { getSetting, getSettingBoolean } from '../services/settings.service.js';
import { storage } from '../services/storage/index.js';

/** Load an image document the caller owns, or throw NOT_FOUND. */
async function loadOwnedImage(userId: string, documentId: string) {
  const [row] = await db
    .select({
      id: documents.id,
      workspaceId: documents.workspaceId,
      title: documents.title,
      filePath: documents.filePath,
      fileType: documents.fileType,
      status: documents.status,
    })
    .from(documents)
    .innerJoin(workspaces, eq(workspaces.id, documents.workspaceId))
    .where(and(eq(documents.id, documentId), eq(workspaces.userId, userId)))
    .limit(1);
  if (!row) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Image not found' });
  }
  if (!isImageFileType(row.fileType)) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'That document is not an image',
    });
  }
  if (row.status !== 'ready') {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'The image is still being indexed - try again in a moment',
    });
  }
  return row;
}

export const visionRouter = t.router({
  /** Capability snapshot for the library and composer (no secrets). */
  config: protectedProcedure.query(async (): Promise<VisionConfig> =>
    visionConfig(),
  ),

  /**
   * Analyse one image with the configured vision model. OCR text (when
   * enabled) is included so labels and equations stay exact, and the result
   * is cached server-side per (image, mode, question).
   */
  analyze: protectedProcedure
    .input(analyzeImageInputSchema)
    .mutation(async ({ ctx, input }): Promise<AnalyzeImageResult> => {
      const doc = await loadOwnedImage(ctx.user.id, input.documentId);

      let buffer: Buffer;
      try {
        buffer = await storage.get(doc.filePath);
      } catch {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'The stored image file is missing',
        });
      }

      const mime = mimeForFormat(doc.fileType);
      let ocrText = '';
      if (
        (await getSettingBoolean('vision.ocrEnabled')) &&
        (await ocrAvailable())
      ) {
        try {
          const languages = (await getSetting('vision.ocrLanguages')) || 'eng';
          ocrText = await ocrImage(buffer, { languages });
        } catch {
          // Analysis can still proceed on the image alone.
        }
      }

      try {
        const result = await analyzeImage({
          buffer,
          mime,
          mode: input.mode,
          question: input.question,
          title: doc.title,
          ocrText,
        });
        return toAnalyzeResult({
          documentId: doc.id,
          mode: input.mode,
          analysis: result.analysis,
          model: result.model,
          ocrText,
          cached: result.cached,
        });
      } catch (error) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message:
            error instanceof Error ? error.message : 'Image analysis failed',
        });
      }
    }),
});

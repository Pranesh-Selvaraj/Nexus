import { z } from 'zod';
export const artifactKindSchema = z.enum([
  'summary',
  'study_guide',
  'glossary',
  'mindmap',
]);
export type ArtifactKind = z.infer<typeof artifactKindSchema>;

export const artifactDTOSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  kind: artifactKindSchema,
  title: z.string(),
  contentMd: z.string(),
  sourceDocumentId: z.string().uuid().nullable(),
  createdAt: z.string(),
});
export type ArtifactDTO = z.infer<typeof artifactDTOSchema>;

export const generateArtifactInputSchema = z
  .object({
    workspaceId: z.string().uuid(),
    documentId: z.string().uuid().optional(),
    text: z.string().trim().min(20).max(8000).optional(),
    kind: artifactKindSchema,
  })
  .refine((value) => value.documentId || value.text, {
    message: 'Provide a documentId or text to build the artifact from',
  });

export const artifactIdSchema = z.object({
  artifactId: z.string().uuid(),
});

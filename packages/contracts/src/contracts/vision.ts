import { z } from 'zod';
export const visionModeSchema = z.enum([
  'general',
  'art',
  'diagram',
  'equation',
]);
export type VisionMode = z.infer<typeof visionModeSchema>;

export const VISION_MODES: { id: VisionMode; label: string; hint: string }[] = [
  {
    id: 'general',
    label: 'Describe',
    hint: 'What is in the image, its text, and how it relates to your material.',
  },
  {
    id: 'art',
    label: 'Art critique',
    hint: 'Composition, colour, technique, and art-historical context.',
  },
  {
    id: 'diagram',
    label: 'Diagram',
    hint: 'Components, labels, flows, and the relationships between them.',
  },
  {
    id: 'equation',
    label: 'Equations',
    hint: 'Transcribe formulas to LaTeX and explain each symbol.',
  },
];

/** Effective vision capabilities for the client (keys stay on the server). */
export const visionConfigSchema = z.object({
  /** The feature switch (settings: vision.enabled). */
  enabled: z.boolean(),
  /** True when a vision-capable provider is configured. */
  available: z.boolean(),
  /** Model used for image requests (empty means the chat model). */
  model: z.string(),
  ocrEnabled: z.boolean(),
  /** True when a tesseract binary (and rasterizer for PDFs) was detected. */
  ocrAvailable: z.boolean(),
  maxImageMb: z.number(),
  modes: z.array(visionModeSchema),
});
export type VisionConfig = z.infer<typeof visionConfigSchema>;

export const analyzeImageInputSchema = z.object({
  workspaceId: z.string().uuid(),
  documentId: z.string().uuid(),
  mode: visionModeSchema.default('general'),
  /** Optional extra instruction from the user. */
  question: z.string().trim().max(2000).optional(),
});
export type AnalyzeImageInput = z.infer<typeof analyzeImageInputSchema>;

export const analyzeImageResultSchema = z.object({
  documentId: z.string().uuid(),
  mode: visionModeSchema,
  analysis: z.string(),
  model: z.string(),
  /** Text OCR extracted (empty when OCR is disabled or unavailable). */
  ocrText: z.string(),
  cached: z.boolean(),
});
export type AnalyzeImageResult = z.infer<typeof analyzeImageResultSchema>;

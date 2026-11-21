import { z } from 'zod';
/** Which engine a speech capability uses: the browser API or the server. */
export const speechProviderSchema = z.enum(['browser', 'server']);
export type SpeechProvider = z.infer<typeof speechProviderSchema>;

export const ttsVoiceSchema = z.enum([
  'alloy',
  'echo',
  'fable',
  'onyx',
  'nova',
  'shimmer',
]);
export type TtsVoice = z.infer<typeof ttsVoiceSchema>;

export const TTS_VOICES: TtsVoice[] = [
  'alloy',
  'echo',
  'fable',
  'onyx',
  'nova',
  'shimmer',
];

export const audioKindSchema = z.enum(['tts', 'stt', 'pronunciation']);
export type AudioKind = z.infer<typeof audioKindSchema>;

/** Result of `POST /api/transcribe` (and the client's browser path). */
export const transcriptionResultSchema = z.object({
  text: z.string(),
  language: z.string().nullable(),
  provider: z.string(),
  durationMs: z.number().int().nonnegative().nullable(),
  /** Retained recording id, or null when retention is disabled. */
  audioId: z.string().uuid().nullable(),
});
export type TranscriptionResult = z.infer<typeof transcriptionResultSchema>;

export const ttsRequestSchema = z.object({
  text: z.string().trim().min(1).max(4000),
  voice: ttsVoiceSchema.optional(),
  speed: z.number().min(0.5).max(2).optional(),
  format: z.enum(['mp3', 'wav']).optional(),
  workspaceId: z.string().uuid().optional(),
});
export type TtsRequest = z.infer<typeof ttsRequestSchema>;

/** Result of `POST /api/tts`: metadata plus a playable URL. */
export const ttsResultSchema = z.object({
  audioId: z.string().uuid(),
  url: z.string(),
  mimeType: z.string(),
  cached: z.boolean(),
  voice: ttsVoiceSchema,
  speed: z.number(),
  /** In-order sentences for karaoke highlighting (client times them). */
  sentences: z.array(z.string()),
});
export type TtsResult = z.infer<typeof ttsResultSchema>;

export const audioAssetDTOSchema = z.object({
  id: z.string().uuid(),
  kind: audioKindSchema,
  mimeType: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative().nullable(),
  createdAt: z.string(),
  expiresAt: z.string().nullable(),
});
export type AudioAssetDTO = z.infer<typeof audioAssetDTOSchema>;

export const correctionPolicySchema = z.enum(['immediate', 'recap', 'asked']);
export type CorrectionPolicy = z.infer<typeof correctionPolicySchema>;

/** Effective voice capabilities for the client (provider keys never leave). */
export const voiceConfigSchema = z.object({
  sttMode: speechProviderSchema,
  ttsProvider: speechProviderSchema,
  sttLanguage: z.string(),
  ttsVoice: ttsVoiceSchema,
  ttsSpeed: z.number(),
  targetLanguage: z.string(),
  nativeLanguage: z.string(),
  correctionPolicy: correctionPolicySchema,
  autoSend: z.boolean(),
  retentionDays: z.number().int(),
  maxStorageMb: z.number(),
  /** True when the server has a usable STT/TTS provider configured. */
  sttServerAvailable: z.boolean(),
  ttsServerAvailable: z.boolean(),
  voices: z.array(ttsVoiceSchema),
  languages: z.array(z.string()),
});
export type VoiceConfig = z.infer<typeof voiceConfigSchema>;

// --- Pronunciation ---------------------------------------------------------

export const pronunciationWordSchema = z.object({
  word: z.string(),
  /** The aligned word the recognizer heard, or null when omitted. */
  heard: z.string().nullable(),
  score: z.number().min(0).max(1),
  status: z.enum(['good', 'close', 'off', 'missing']),
});
export type PronunciationWord = z.infer<typeof pronunciationWordSchema>;

export const pronunciationScoreSchema = z.object({
  id: z.string().uuid(),
  target: z.string(),
  transcript: z.string(),
  overall: z.number().min(0).max(1),
  words: z.array(pronunciationWordSchema),
  language: z.string().nullable(),
  createdAt: z.string(),
});
export type PronunciationScore = z.infer<typeof pronunciationScoreSchema>;

export const scorePronunciationInputSchema = z.object({
  workspaceId: z.string().uuid(),
  target: z.string().trim().min(1).max(500),
  transcript: z.string().trim().min(1).max(2000),
  language: z.string().max(40).optional(),
  durationMs: z.number().int().nonnegative().optional(),
});
export type ScorePronunciationInput = z.infer<
  typeof scorePronunciationInputSchema
>;

export const minimalPairSchema = z.object({
  a: z.string(),
  b: z.string(),
  hint: z.string(),
});
export type MinimalPair = z.infer<typeof minimalPairSchema>;

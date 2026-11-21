import { z } from 'zod';
export const webhookEventSchema = z.enum([
  'document.indexed',
  'document.failed',
]);
export type WebhookEvent = z.infer<typeof webhookEventSchema>;

export const WEBHOOK_EVENTS: WebhookEvent[] = [
  'document.indexed',
  'document.failed',
];

export const webhookDTOSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid().nullable(),
  url: z.string(),
  events: z.array(webhookEventSchema),
  enabled: z.boolean(),
  createdAt: z.string(),
  lastDeliveryAt: z.string().nullable(),
  lastStatus: z.number().int().nullable(),
  lastError: z.string().nullable(),
});
export type WebhookDTO = z.infer<typeof webhookDTOSchema>;

export const createWebhookInputSchema = z.object({
  url: z.string().trim().url().max(2048),
  /** Null/omitted = every workspace owned by the caller. */
  workspaceId: z.string().uuid().optional(),
  events: z.array(webhookEventSchema).min(1),
});
export type CreateWebhookInput = z.infer<typeof createWebhookInputSchema>;

export const createdWebhookSchema = webhookDTOSchema.extend({
  /** HMAC key for `X-Nexus-Signature`, returned exactly once. */
  secret: z.string(),
});
export type CreatedWebhook = z.infer<typeof createdWebhookSchema>;

export const updateWebhookInputSchema = z.object({
  id: z.string().uuid(),
  enabled: z.boolean().optional(),
  url: z.string().trim().url().max(2048).optional(),
  events: z.array(webhookEventSchema).min(1).optional(),
});
export type UpdateWebhookInput = z.infer<typeof updateWebhookInputSchema>;

export const webhookIdSchema = z.object({ id: z.string().uuid() });

/** Payload delivered to the endpoint (JSON body, signed). */
export const webhookPayloadSchema = z.object({
  event: webhookEventSchema,
  deliveryId: z.string(),
  createdAt: z.string(),
  data: z.object({
    documentId: z.string().uuid(),
    workspaceId: z.string().uuid(),
    title: z.string().optional(),
    chunkCount: z.number().int().nonnegative().optional(),
    error: z.string().optional(),
  }),
});
export type WebhookPayload = z.infer<typeof webhookPayloadSchema>;

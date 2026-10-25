import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import dns from 'node:dns/promises';

import { and, eq, isNull, or } from 'drizzle-orm';

import type {
  CreateWebhookInput,
  CreatedWebhook,
  UpdateWebhookInput,
  WebhookDTO,
  WebhookEvent,
  WebhookPayload,
} from '@nexus/shared-types';
import { WEBHOOK_EVENTS } from '@nexus/shared-types';

import { db } from '../db/index.js';
import { webhooks } from '../db/schema.js';
import { enqueueWebhookDelivery } from '../queues/index.js';
import { ApiError } from '../utils/errors.js';
import {
  isBlockedAddress,
  parseSafeUrl,
  type UnsafeUrlError,
} from './ingestion/url-fetch.js';
import {
  decryptSecret,
  encryptSecret,
  encryptionKeyConfigured,
} from './settings.service.js';

/** Delivery timeout: a slow receiver must not hold a worker slot. */
const DELIVERY_TIMEOUT_MS = 5_000;

type WebhookRow = typeof webhooks.$inferSelect;

function toDTO(row: WebhookRow): WebhookDTO {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    url: row.url,
    events: row.events.filter((event): event is WebhookEvent =>
      (WEBHOOK_EVENTS as string[]).includes(event),
    ),
    enabled: row.enabled,
    createdAt: row.createdAt.toISOString(),
    lastDeliveryAt: row.lastDeliveryAt?.toISOString() ?? null,
    lastStatus: row.lastStatus,
    lastError: row.lastError,
  };
}

/**
 * Webhook targets are user-supplied URLs fetched by the server, so they get
 * the same address classification as ingestion. `WEBHOOK_ALLOW_PRIVATE_HOSTS`
 * is the deliberate local/testing override (kept separate from the ingestion
 * override so exposing one never exposes the other).
 */
export async function assertWebhookTarget(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = parseSafeUrl(raw);
  } catch (err) {
    throw new ApiError((err as UnsafeUrlError).message, 400);
  }
  if (process.env.WEBHOOK_ALLOW_PRIVATE_HOSTS === 'true') return url;

  let addresses: Array<{ address: string }>;
  try {
    addresses = await dns.lookup(url.hostname.replace(/^\[|\]$/g, ''), {
      all: true,
      verbatim: true,
    });
  } catch {
    throw new ApiError(`Could not resolve "${url.hostname}"`, 400);
  }
  if (addresses.length === 0) {
    throw new ApiError(`Could not resolve "${url.hostname}"`, 400);
  }
  for (const entry of addresses) {
    if (isBlockedAddress(entry.address)) {
      throw new ApiError(
        'Refusing a webhook target on a private or link-local address (set WEBHOOK_ALLOW_PRIVATE_HOSTS=true only for local testing)',
        400,
      );
    }
  }
  return url;
}

function toPayload(
  event: WebhookEvent,
  data: WebhookPayload['data'],
): WebhookPayload {
  return {
    event,
    deliveryId: randomUUID(),
    createdAt: new Date().toISOString(),
    data,
  };
}

export async function createWebhook(
  userId: string,
  input: CreateWebhookInput,
): Promise<CreatedWebhook> {
  if (!encryptionKeyConfigured()) {
    throw new ApiError(
      'Webhooks need SETTINGS_SECRET so their signing secret can be encrypted at rest. Set it in .env (e.g. openssl rand -hex 32) and restart the backend.',
      400,
    );
  }
  await assertWebhookTarget(input.url);
  const secret = randomBytes(32).toString('hex');
  const [row] = await db
    .insert(webhooks)
    .values({
      userId,
      workspaceId: input.workspaceId ?? null,
      url: input.url,
      secret: encryptSecret(secret),
      events: [...new Set(input.events)],
    })
    .returning();
  if (!row) throw new ApiError('Could not create the webhook', 500);
  return { ...toDTO(row), secret };
}

export async function listWebhooks(userId: string): Promise<WebhookDTO[]> {
  const rows = await db
    .select()
    .from(webhooks)
    .where(eq(webhooks.userId, userId))
    .orderBy(webhooks.createdAt);
  return rows.map(toDTO);
}

export async function updateWebhook(
  userId: string,
  input: UpdateWebhookInput,
): Promise<WebhookDTO> {
  if (input.url) await assertWebhookTarget(input.url);
  const [row] = await db
    .update(webhooks)
    .set({
      ...(input.url !== undefined ? { url: input.url } : {}),
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      ...(input.events !== undefined
        ? { events: [...new Set(input.events)] }
        : {}),
    })
    .where(and(eq(webhooks.id, input.id), eq(webhooks.userId, userId)))
    .returning();
  if (!row) throw new ApiError('Webhook not found', 404);
  return toDTO(row);
}

export async function deleteWebhook(
  userId: string,
  id: string,
): Promise<{ deleted: boolean }> {
  const deleted = await db
    .delete(webhooks)
    .where(and(eq(webhooks.id, id), eq(webhooks.userId, userId)))
    .returning({ id: webhooks.id });
  return { deleted: deleted.length > 0 };
}

/**
 * Queue a signed sample delivery so the user can verify their receiver before
 * relying on it. The document id is random: nothing real is referenced.
 */
export async function sendTestWebhook(
  userId: string,
  id: string,
): Promise<{ queued: boolean }> {
  const [row] = await db
    .select()
    .from(webhooks)
    .where(and(eq(webhooks.id, id), eq(webhooks.userId, userId)))
    .limit(1);
  if (!row) throw new ApiError('Webhook not found', 404);
  await enqueueWebhookDelivery({
    webhookId: row.id,
    payload: toPayload('document.indexed', {
      documentId: randomUUID(),
      workspaceId: row.workspaceId ?? randomUUID(),
      title: 'Nexus webhook test',
      chunkCount: 0,
    }),
  });
  return { queued: true };
}

/**
 * Fan out one event to every enabled endpoint of the document's owner that
 * subscribes to it (workspace-scoped or global). A queue failure is logged and
 * swallowed: indexing must never fail because a notification could not be
 * queued.
 */
export async function emitWebhookEvent(params: {
  userId: string;
  workspaceId: string;
  event: WebhookEvent;
  data: WebhookPayload['data'];
}): Promise<void> {
  const hooks = await db
    .select({ id: webhooks.id, events: webhooks.events })
    .from(webhooks)
    .where(
      and(
        eq(webhooks.userId, params.userId),
        eq(webhooks.enabled, true),
        or(
          isNull(webhooks.workspaceId),
          eq(webhooks.workspaceId, params.workspaceId),
        ),
      ),
    )
    .catch(() => [] as Array<{ id: string; events: string[] }>);

  const payload = toPayload(params.event, params.data);
  for (const hook of hooks) {
    if (!hook.events.includes(params.event)) continue;
    await enqueueWebhookDelivery({
      webhookId: hook.id,
      payload,
    }).catch(() => undefined);
  }
}

/**
 * Deliver one queued webhook: POST the signed JSON payload and record the
 * result on the endpoint row. Non-2xx and network errors throw so BullMQ
 * retries with backoff.
 */
export async function deliverWebhook(params: {
  webhookId: string;
  payload: WebhookPayload;
}): Promise<void> {
  const [row] = await db
    .select()
    .from(webhooks)
    .where(eq(webhooks.id, params.webhookId))
    .limit(1);
  if (!row) return; // endpoint deleted between queue and delivery
  if (!row.enabled) return;

  await assertWebhookTarget(row.url);

  const body = JSON.stringify(params.payload);
  const signature = createHmac('sha256', decryptSecret(row.secret))
    .update(body)
    .digest('hex');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);
  let status: number | null = null;
  let error: string | null = null;

  try {
    const res = await fetch(row.url, {
      method: 'POST',
      // No redirects: a receiver that redirects would bypass the address check.
      redirect: 'error',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        'user-agent': 'Nexus-Webhooks/1.0',
        'x-nexus-event': params.payload.event,
        'x-nexus-delivery': params.payload.deliveryId,
        'x-nexus-signature': `sha256=${signature}`,
      },
      body,
    });
    status = res.status;
    if (!res.ok) error = `HTTP ${res.status}`;
  } catch (err) {
    error =
      err instanceof Error
        ? err.name === 'AbortError'
          ? `Timed out after ${DELIVERY_TIMEOUT_MS}ms`
          : err.message
        : 'Delivery failed';
  } finally {
    clearTimeout(timer);
  }

  await db
    .update(webhooks)
    .set({
      lastDeliveryAt: new Date(),
      lastStatus: status,
      lastError: error,
    })
    .where(eq(webhooks.id, row.id))
    .catch(() => undefined);

  if (error) throw new Error(error);
}

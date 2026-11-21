import type { MessageDTO } from '@nexus/shared-types';
import type { Message } from './types';
export function toLocalMessage(message: MessageDTO): Message {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    sources: message.sources ?? undefined,
    attachments: message.attachments ?? undefined,
    usage: message.usage,
    feedback: message.feedback ?? null,
    retrieval: message.retrievalDebug ?? null,
    error: message.kind === 'error',
  };
}

export function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

export function pct(value: number | undefined): string {
  return value == null ? '—' : `${Math.round(value * 100)}%`;
}

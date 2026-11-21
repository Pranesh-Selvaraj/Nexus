/**
 * Tiny event bus for session expiry. The React Query caches emit
 * `unauthorized` for any UNAUTHORIZED tRPC error; App subscribes and swaps
 * to the login screen instead of leaving every panel stuck in an error state.
 */
type Listener = () => void;

const listeners = new Set<Listener>();

/** Subscribe to unauthorized events; returns an unsubscribe function. */
export function onUnauthorized(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function emitUnauthorized(): void {
  for (const listener of listeners) listener();
}

/** True for a tRPC client error carrying code UNAUTHORIZED. */
export function isUnauthorizedError(error: unknown): boolean {
  const code = (error as { data?: { code?: string } } | undefined)?.data?.code;
  return code === 'UNAUTHORIZED';
}

import { and, asc, eq } from 'drizzle-orm';

import { db } from '../db/index.js';
import { decks } from '../db/schema.js';

/** The workspace's default deck, created on first use. */
export async function getOrCreateDefaultDeck(
  workspaceId: string,
): Promise<string> {
  const [existing] = await db
    .select({ id: decks.id })
    .from(decks)
    .where(eq(decks.workspaceId, workspaceId))
    .orderBy(asc(decks.createdAt))
    .limit(1);
  if (existing) return existing.id;

  const [created] = await db
    .insert(decks)
    .values({ workspaceId, name: 'Study' })
    .returning({ id: decks.id });
  if (!created) {
    throw new Error('Failed to create the default deck');
  }
  return created.id;
}

/** Ownership check for a deck inside a workspace. */
export async function findDeck(
  workspaceId: string,
  deckId: string,
): Promise<{ id: string } | null> {
  const [deck] = await db
    .select({ id: decks.id })
    .from(decks)
    .where(and(eq(decks.id, deckId), eq(decks.workspaceId, workspaceId)))
    .limit(1);
  return deck ?? null;
}

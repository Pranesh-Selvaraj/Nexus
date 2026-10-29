import type { PacksOverview, WorkspaceDTO } from '@nexus/shared-types';

import { db } from '../db/index.js';
import { workspaceAccessPredicate } from '../services/access.service.js';
import {
  conversations,
  decks,
  flashcards,
  messages,
  notes,
  workspaces,
} from '../db/schema.js';
import { DOMAIN_PACKS, findPack, toDomainPack } from '../domain-packs/index.js';
import { ApiError } from '../utils/errors.js';
import { ensureOwnerMembership } from './member.service.js';

/** Built-in packs plus which one the user already installed, and where. */
export async function listPacks(userId: string): Promise<PacksOverview> {
  const rows = await db
    .select({ id: workspaces.id, metadata: workspaces.metadata })
    .from(workspaces)
    .where(workspaceAccessPredicate(userId));
  const installed: Record<string, string> = {};
  for (const row of rows) {
    const packId = row.metadata?.packId;
    if (packId && !installed[packId]) installed[packId] = row.id;
  }
  return { packs: DOMAIN_PACKS.map(toDomainPack), installed };
}

/**
 * Install a pack into a new topic: the workspace carries the pack metadata,
 * a starter deck is created and made due now, a plan note is written and a
 * welcome conversation explains the plan and starter questions. Everything is
 * ordinary user data afterwards — the pack is a starting point, not a lock-in.
 */
export async function installPack(
  userId: string,
  packId: string,
  customName?: string,
): Promise<WorkspaceDTO> {
  const pack = findPack(packId);
  if (!pack) throw new ApiError('Domain pack not found', 404);

  const [workspace] = await db
    .insert(workspaces)
    .values({
      userId,
      name: customName?.trim() || pack.name,
      description: pack.description,
      metadata: {
        packId: pack.id,
        icon: pack.icon,
        personaId: pack.personaId,
        starterPrompts: pack.starterPrompts,
        plan: pack.plan,
      },
    })
    .returning();
  if (!workspace) throw new ApiError('Could not create the topic', 500);
  await ensureOwnerMembership(workspace.id, userId);

  const [deck] = await db
    .insert(decks)
    .values({
      workspaceId: workspace.id,
      name: `${pack.name} · starter deck`,
    })
    .returning();
  if (deck && pack.cards.length > 0) {
    await db.insert(flashcards).values(
      pack.cards.map((card) => ({
        deckId: deck.id,
        front: card.front,
        back: card.back,
      })),
    );
  }

  const planMarkdown = [
    `# ${pack.plan.title}`,
    '',
    ...pack.plan.steps.map((step, index) => `- [ ] ${index + 1}. ${step}`),
    '',
    '## Questions to start with',
    '',
    ...pack.starterPrompts.map((prompt) => `- ${prompt}`),
  ].join('\n');
  await db.insert(notes).values({
    workspaceId: workspace.id,
    title: pack.plan.title,
    contentMd: planMarkdown,
    tags: ['pack', pack.domain],
  });

  const [conversation] = await db
    .insert(conversations)
    .values({
      workspaceId: workspace.id,
      title: `Start here: ${pack.name}`,
    })
    .returning();
  if (conversation) {
    const intro = [
      `Welcome to **${pack.name}**.`,
      '',
      `Your plan: **${pack.plan.title}**`,
      '',
      ...pack.plan.steps.map((step, index) => `${index + 1}. ${step}`),
      '',
      'Try one of these to begin:',
      '',
      ...pack.starterPrompts.map((prompt) => `- “${prompt}”`),
      '',
      `A starter deck with ${pack.cards.length} cards is ready in **Practice**;`,
      'add your own sources in the Sources rail to ground answers in your material.',
    ].join('\n');
    await db.insert(messages).values({
      conversationId: conversation.id,
      role: 'assistant',
      content: intro,
    });
  }

  return {
    id: workspace.id,
    name: workspace.name,
    description: workspace.description,
    documentCount: 0,
    createdAt: new Date(workspace.createdAt).toISOString(),
    metadata: workspace.metadata ?? null,
  };
}

import type {
  CefrLevel,
  CefrProfile,
  CefrSkill,
  DictationScore,
  LanguageSkill,
} from '@nexus/shared-types';
import { CEFR_LEVELS } from '@nexus/shared-types';
import { sql } from 'drizzle-orm';

import { db } from '../db/index.js';
import { cefrEstimates, progressEvents } from '../db/schema.js';
import { getSetting } from './settings.service.js';
import { dictationAccuracy, dictationDiff } from './text-utils.js';

export const LANGUAGE_SKILLS: LanguageSkill[] = [
  'reading',
  'writing',
  'listening',
  'speaking',
];

/**
 * Map an accuracy/retention score (0..1) to a CEFR band. These thresholds
 * are deliberately conservative and shared by every skill so the badges are
 * comparable; they are an estimate, not a certification.
 */
export function levelFromScore(score: number): CefrLevel {
  if (score >= 0.95) return 'C2';
  if (score >= 0.88) return 'C1';
  if (score >= 0.78) return 'B2';
  if (score >= 0.65) return 'B1';
  if (score >= 0.5) return 'A2';
  return 'A1';
}

/** Rank a CEFR level for the "overall" aggregate (higher is better). */
export function levelRank(level: CefrLevel): number {
  return CEFR_LEVELS.indexOf(level);
}

export function levelFromRank(rank: number): CefrLevel {
  const clamped = Math.max(
    0,
    Math.min(CEFR_LEVELS.length - 1, Math.round(rank)),
  );
  return CEFR_LEVELS[clamped] as CefrLevel;
}

/**
 * Convert per-skill evidence into a level. Below `minEvidence` the seeded
 * level is kept and the score is reported as 0 so the UI can distinguish
 * "no data" from "measured low".
 */
export function levelForSkill(
  score: number,
  evidence: number,
  seed: CefrLevel,
  minEvidence = 3,
): CefrLevel {
  if (evidence < minEvidence) return seed;
  return levelFromScore(score);
}

interface SkillAggregate {
  score: number;
  evidence: number;
}

function toAggregate(value: unknown): SkillAggregate {
  const row = value as
    { score: number | string | null; evidence: number } | undefined;
  return {
    score: Number(row?.score ?? 0),
    evidence: Number(row?.evidence ?? 0),
  };
}

async function readingAggregate(workspaceId: string): Promise<SkillAggregate> {
  const result = await db.execute(sql`
    SELECT
      COUNT(*)::int AS evidence,
      COALESCE(AVG(CASE WHEN r.rating >= 2 THEN 1.0 ELSE 0.0 END), 0)::float AS score
    FROM card_reviews r
    JOIN flashcards c ON c.id = r.card_id
    JOIN decks d ON d.id = c.deck_id
    WHERE d.workspace_id = ${workspaceId}
  `);
  return toAggregate((result as unknown as { rows: unknown[] }).rows[0]);
}

async function listeningAggregate(
  workspaceId: string,
): Promise<SkillAggregate> {
  const result = await db.execute(sql`
    SELECT
      COUNT(*)::int AS evidence,
      COALESCE(AVG(CASE WHEN correct THEN 1.0 ELSE 0.0 END), 0)::float AS score
    FROM progress_events
    WHERE workspace_id = ${workspaceId} AND kind = 'dictation'
  `);
  return toAggregate((result as unknown as { rows: unknown[] }).rows[0]);
}

async function speakingAggregate(workspaceId: string): Promise<SkillAggregate> {
  const result = await db.execute(sql`
    SELECT
      COUNT(*)::int AS evidence,
      COALESCE(AVG(overall), 0)::float AS score
    FROM pronunciation_attempts
    WHERE workspace_id = ${workspaceId}
  `);
  return toAggregate((result as unknown as { rows: unknown[] }).rows[0]);
}

async function writingAggregate(workspaceId: string): Promise<SkillAggregate> {
  const result = await db.execute(sql`
    SELECT
      COUNT(*)::int AS evidence,
      COALESCE(AVG(a.score), 0)::float AS score
    FROM quiz_attempts a
    JOIN quizzes q ON q.id = a.quiz_id
    WHERE q.workspace_id = ${workspaceId}
  `);
  return toAggregate((result as unknown as { rows: unknown[] }).rows[0]);
}

/**
 * Estimate and persist a CEFR level per skill for a workspace. Every call
 * recomputes from evidence so the profile tracks practice over time.
 */
export async function estimateCefr(workspaceId: string): Promise<CefrProfile> {
  const [seedSetting, targetLanguage] = await Promise.all([
    getSetting('language.level'),
    getSetting('language.target'),
  ]);
  const seed = (
    CEFR_LEVELS.includes(seedSetting as CefrLevel) ? seedSetting : 'B1'
  ) as CefrLevel;

  const [reading, writing, listening, speaking] = await Promise.all([
    readingAggregate(workspaceId),
    writingAggregate(workspaceId),
    listeningAggregate(workspaceId),
    speakingAggregate(workspaceId),
  ]);
  const aggregates: Record<LanguageSkill, SkillAggregate> = {
    reading,
    writing,
    listening,
    speaking,
  };

  const skills: CefrSkill[] = [];
  for (const skill of LANGUAGE_SKILLS) {
    const aggregate = aggregates[skill];
    const level = levelForSkill(aggregate.score, aggregate.evidence, seed);
    // Unique (workspace, skill) makes this an atomic upsert, so concurrent
    // dashboard reads can never create duplicate estimate rows.
    const [row] = await db
      .insert(cefrEstimates)
      .values({
        workspaceId,
        skill,
        level,
        score: aggregate.score,
        evidence: aggregate.evidence,
      })
      .onConflictDoUpdate({
        target: [cefrEstimates.workspaceId, cefrEstimates.skill],
        set: {
          level,
          score: aggregate.score,
          evidence: aggregate.evidence,
          updatedAt: new Date(),
        },
      })
      .returning();
    if (!row) continue;
    skills.push({
      skill,
      level: row.level as CefrLevel,
      score: row.score,
      evidence: row.evidence,
      updatedAt: new Date(row.updatedAt).toISOString(),
    });
  }

  const measured = skills.filter((skill) => skill.evidence > 0);
  const overallRank =
    measured.length === 0
      ? levelRank(seed)
      : Math.round(
          measured.reduce((sum, skill) => sum + levelRank(skill.level), 0) /
            measured.length,
        );

  return {
    workspaceId,
    overall: levelFromRank(overallRank),
    skills,
    targetLanguage,
  };
}

/** Word-level dictation scoring, recorded as a listening progress event. */
export async function scoreDictation(input: {
  userId: string;
  workspaceId: string;
  target: string;
  typed: string;
  language?: string;
}): Promise<DictationScore> {
  const words = dictationDiff(input.target, input.typed);
  const { accuracy, correct, total } = dictationAccuracy(words);
  await db.insert(progressEvents).values({
    userId: input.userId,
    workspaceId: input.workspaceId,
    kind: 'dictation',
    subject: input.language ?? null,
    correct: accuracy >= 0.9,
    durationMs: null,
  });
  return { accuracy, correct, total, words };
}

import { TRPCError } from '@trpc/server';
import { and, asc, eq, sql } from 'drizzle-orm';

import type { QuizDTO, QuizDetail, QuizResult } from '@nexus/shared-types';
import {
  generateQuizInputSchema,
  quizIdSchema,
  submitQuizInputSchema,
  workspaceIdSchema,
} from '@nexus/shared-types';

import { db } from '../db/index.js';
import {
  flashcards,
  progressEvents,
  quizAttempts,
  quizQuestions,
  quizzes,
  workspaces,
} from '../db/schema.js';
import { protectedProcedure, t } from '../middleware/auth.js';
import { getOrCreateDefaultDeck } from '../services/deck.service.js';
import { emptySchedule } from '../services/fsrs.service.js';
import {
  generateQuizFromText,
  gradeShortAnswers,
} from '../services/quiz.service.js';
import { loadDocumentText } from '../services/source-text.service.js';

async function assertWorkspaceOwnership(
  userId: string,
  workspaceId: string,
): Promise<void> {
  const [workspace] = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(and(eq(workspaces.id, workspaceId), eq(workspaces.userId, userId)))
    .limit(1);
  if (!workspace) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Workspace not found' });
  }
}

function toQuizDTO(row: {
  id: string;
  workspace_id: string;
  title: string;
  created_at: Date;
  question_count: number;
  attempts: number;
  best_score: number | string | null;
}): QuizDTO {
  const best = row.best_score == null ? null : Number(row.best_score);
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    title: row.title,
    questionCount: Number(row.question_count),
    attempts: Number(row.attempts),
    bestScore: best == null || Number.isNaN(best) ? null : best,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

export const quizRouter = t.router({
  list: protectedProcedure
    .input(workspaceIdSchema)
    .query(async ({ ctx, input }): Promise<QuizDTO[]> => {
      await assertWorkspaceOwnership(ctx.user.id, input.workspaceId);
      const result = await db.execute(
        sql`
          SELECT q.id, q.workspace_id, q.title, q.created_at,
            (SELECT COUNT(*)::int FROM quiz_questions qq WHERE qq.quiz_id = q.id) AS question_count,
            (SELECT COUNT(*)::int FROM quiz_attempts a WHERE a.quiz_id = q.id) AS attempts,
            (SELECT MAX(a.score) FROM quiz_attempts a WHERE a.quiz_id = q.id) AS best_score
          FROM quizzes q
          WHERE q.workspace_id = ${input.workspaceId}
          ORDER BY q.created_at DESC
          LIMIT 200
        `,
      );
      const rows = (
        result as unknown as {
          rows: Array<{
            id: string;
            workspace_id: string;
            title: string;
            created_at: Date;
            question_count: number;
            attempts: number;
            best_score: number | string | null;
          }>;
        }
      ).rows;
      return rows.map(toQuizDTO);
    }),

  get: protectedProcedure
    .input(quizIdSchema)
    .query(async ({ ctx, input }): Promise<QuizDetail> => {
      const [quiz] = await db
        .select({
          id: quizzes.id,
          workspaceId: quizzes.workspaceId,
          title: quizzes.title,
          createdAt: quizzes.createdAt,
        })
        .from(quizzes)
        .innerJoin(workspaces, eq(workspaces.id, quizzes.workspaceId))
        .where(
          and(eq(quizzes.id, input.quizId), eq(workspaces.userId, ctx.user.id)),
        )
        .limit(1);
      if (!quiz) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Quiz not found' });
      }

      const questions = await db
        .select({
          id: quizQuestions.id,
          kind: quizQuestions.kind,
          prompt: quizQuestions.prompt,
          options: quizQuestions.options,
          explanation: quizQuestions.explanation,
        })
        .from(quizQuestions)
        .where(eq(quizQuestions.quizId, quiz.id))
        .orderBy(asc(quizQuestions.position));

      return {
        id: quiz.id,
        workspaceId: quiz.workspaceId,
        title: quiz.title,
        questionCount: questions.length,
        attempts: 0,
        bestScore: null,
        createdAt: new Date(quiz.createdAt).toISOString(),
        questions: questions.map((question) => ({
          id: question.id,
          kind: (['mcq', 'truefalse', 'short'] as const).includes(
            question.kind as never,
          )
            ? (question.kind as 'mcq' | 'truefalse' | 'short')
            : 'short',
          prompt: question.prompt,
          options: question.options,
          explanation: question.explanation,
        })),
      };
    }),

  generate: protectedProcedure
    .input(generateQuizInputSchema)
    .mutation(async ({ ctx, input }): Promise<QuizDTO> => {
      await assertWorkspaceOwnership(ctx.user.id, input.workspaceId);
      const sourceText = input.documentId
        ? await loadDocumentText(input.workspaceId, input.documentId)
        : (input.text ?? '');

      const generated = await generateQuizFromText(
        sourceText,
        input.count,
        input.kinds,
      );
      if (generated.length === 0) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message:
            'Could not generate quiz questions from this material. Try different question types or a longer passage.',
        });
      }

      const [quiz] = await db
        .insert(quizzes)
        .values({
          workspaceId: input.workspaceId,
          title: `Quiz · ${new Date().toISOString().slice(0, 10)}`,
        })
        .returning();
      if (!quiz) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
      }

      await db.insert(quizQuestions).values(
        generated.map((question, index) => ({
          quizId: quiz.id,
          position: index,
          kind: question.kind,
          prompt: question.prompt,
          options: question.options,
          answer: question.answer,
          explanation: question.explanation,
        })),
      );

      return {
        id: quiz.id,
        workspaceId: quiz.workspaceId,
        title: quiz.title,
        questionCount: generated.length,
        attempts: 0,
        bestScore: null,
        createdAt: new Date(quiz.createdAt).toISOString(),
      };
    }),

  submit: protectedProcedure
    .input(submitQuizInputSchema)
    .mutation(async ({ ctx, input }): Promise<QuizResult> => {
      const [quiz] = await db
        .select({
          id: quizzes.id,
          workspaceId: quizzes.workspaceId,
        })
        .from(quizzes)
        .innerJoin(workspaces, eq(workspaces.id, quizzes.workspaceId))
        .where(
          and(eq(quizzes.id, input.quizId), eq(workspaces.userId, ctx.user.id)),
        )
        .limit(1);
      if (!quiz) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Quiz not found' });
      }

      const questions = await db
        .select()
        .from(quizQuestions)
        .where(eq(quizQuestions.quizId, quiz.id))
        .orderBy(asc(quizQuestions.position));

      const answerByQuestion = new Map(
        input.answers.map((answer) => [
          answer.questionId,
          answer.answer.trim(),
        ]),
      );

      // Short answers are graded by the model once; everything else locally.
      const shortItems = questions
        .filter((question) => question.kind === 'short')
        .map((question) => ({
          prompt: question.prompt,
          expected: typeof question.answer === 'string' ? question.answer : '',
          answer: answerByQuestion.get(question.id) ?? '',
        }));
      const shortGrades = await gradeShortAnswers(shortItems);
      const shortGradeByPrompt = new Map(
        shortItems.map((item, index) => [item.prompt, shortGrades[index]]),
      );

      const results: QuizResult['results'] = [];
      let correctCount = 0;
      const mistakes: {
        prompt: string;
        correctAnswer: string;
        explanation: string | null;
      }[] = [];

      for (const question of questions) {
        const yourAnswer = answerByQuestion.get(question.id) ?? '';
        const correctAnswer =
          typeof question.answer === 'string'
            ? question.answer
            : question.answer === true
              ? 'true'
              : 'false';
        let correct: boolean;
        let feedback: string | null = null;

        if (question.kind === 'short') {
          const grade = shortGradeByPrompt.get(question.prompt) ?? {
            correct: false,
            feedback: null,
          };
          correct = grade.correct;
          feedback = grade.feedback;
        } else if (question.kind === 'truefalse') {
          correct = yourAnswer.toLowerCase() === correctAnswer.toLowerCase();
        } else {
          correct = yourAnswer.toLowerCase() === correctAnswer.toLowerCase();
        }

        if (correct) correctCount += 1;
        else {
          mistakes.push({
            prompt: question.prompt,
            correctAnswer,
            explanation: question.explanation,
          });
        }

        results.push({
          questionId: question.id,
          prompt: question.prompt,
          kind: question.kind as 'mcq' | 'truefalse' | 'short',
          yourAnswer,
          correctAnswer,
          correct,
          explanation: question.explanation,
          feedback,
        });
      }

      const total = results.length;
      const score = total > 0 ? correctCount / total : 0;

      await db.insert(quizAttempts).values({
        quizId: quiz.id,
        userId: ctx.user.id,
        answers: input.answers,
        score,
        finishedAt: new Date(),
      });
      await db.insert(progressEvents).values({
        userId: ctx.user.id,
        workspaceId: quiz.workspaceId,
        kind: 'quiz',
        subject: quiz.id,
        correct: score >= 0.5,
      });

      // The mistake notebook: wrong answers become cards in the default deck.
      let cardsCreated = 0;
      if (input.createCardsForMistakes && mistakes.length > 0) {
        const deckId = await getOrCreateDefaultDeck(quiz.workspaceId);
        for (const mistake of mistakes) {
          await db.insert(flashcards).values({
            deckId,
            kind: 'qa',
            front: mistake.prompt,
            back: mistake.explanation
              ? `${mistake.correctAnswer}\n\n${mistake.explanation}`
              : mistake.correctAnswer,
            ...emptySchedule(),
          });
          cardsCreated += 1;
        }
      }

      return {
        score,
        correct: correctCount,
        total,
        cardsCreated,
        results,
      };
    }),

  delete: protectedProcedure
    .input(quizIdSchema)
    .mutation(async ({ ctx, input }): Promise<{ deleted: boolean }> => {
      const [quiz] = await db
        .select({ id: quizzes.id })
        .from(quizzes)
        .innerJoin(workspaces, eq(workspaces.id, quizzes.workspaceId))
        .where(
          and(eq(quizzes.id, input.quizId), eq(workspaces.userId, ctx.user.id)),
        )
        .limit(1);
      if (!quiz) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Quiz not found' });
      }
      await db.delete(quizzes).where(eq(quizzes.id, quiz.id));
      return { deleted: true };
    }),
});

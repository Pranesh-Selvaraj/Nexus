import { z } from 'zod';
export const quizKindSchema = z.enum(['mcq', 'truefalse', 'short']);
export type QuizKind = z.infer<typeof quizKindSchema>;

export const quizQuestionDTOSchema = z.object({
  id: z.string().uuid(),
  kind: quizKindSchema,
  prompt: z.string(),
  options: z.array(z.string()).nullable(),
  explanation: z.string().nullable(),
});
export type QuizQuestionDTO = z.infer<typeof quizQuestionDTOSchema>;

export const quizDTOSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  title: z.string(),
  questionCount: z.number().int().nonnegative(),
  attempts: z.number().int().nonnegative(),
  bestScore: z.number().min(0).max(1).nullable(),
  createdAt: z.string(),
});
export type QuizDTO = z.infer<typeof quizDTOSchema>;

export const quizDetailSchema = quizDTOSchema.extend({
  questions: z.array(quizQuestionDTOSchema),
});
export type QuizDetail = z.infer<typeof quizDetailSchema>;

export const generateQuizInputSchema = z
  .object({
    workspaceId: z.string().uuid(),
    documentId: z.string().uuid().optional(),
    text: z.string().trim().min(20).max(8000).optional(),
    count: z.number().int().min(1).max(20).default(5),
    kinds: z.array(quizKindSchema).min(1).default(['mcq', 'truefalse']),
  })
  .refine((value) => value.documentId || value.text, {
    message: 'Provide a documentId or text to build the quiz from',
  });

export const quizIdSchema = z.object({ quizId: z.string().uuid() });

export const submitQuizInputSchema = z.object({
  quizId: z.string().uuid(),
  answers: z
    .array(
      z.object({
        questionId: z.string().uuid(),
        answer: z.string().max(2000),
      }),
    )
    .max(20),
  createCardsForMistakes: z.boolean().default(true),
});

export const quizResultSchema = z.object({
  score: z.number().min(0).max(1),
  correct: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  cardsCreated: z.number().int().nonnegative(),
  results: z.array(
    z.object({
      questionId: z.string().uuid(),
      prompt: z.string(),
      kind: quizKindSchema,
      yourAnswer: z.string(),
      correctAnswer: z.string(),
      correct: z.boolean(),
      explanation: z.string().nullable(),
      feedback: z.string().nullable(),
    }),
  ),
});
export type QuizResult = z.infer<typeof quizResultSchema>;

import type { ArtifactKind, QuizKind, ReviewRating } from '@nexus/shared-types';

export const RATING_BUTTONS: {
  rating: ReviewRating;
  label: string;
  className: string;
}[] = [
  {
    rating: 'again',
    label: 'Again',
    className: 'bg-red-950/60 text-red-300 hover:bg-red-900/60',
  },
  {
    rating: 'hard',
    label: 'Hard',
    className: 'bg-amber-950/60 text-amber-300 hover:bg-amber-900/60',
  },
  {
    rating: 'good',
    label: 'Good',
    className: 'bg-emerald-950/60 text-emerald-300 hover:bg-emerald-900/60',
  },
  {
    rating: 'easy',
    label: 'Easy',
    className: 'bg-sky-950/60 text-sky-300 hover:bg-sky-900/60',
  },
];

export const QUIZ_KIND_LABELS: Record<QuizKind, string> = {
  mcq: 'Multiple choice',
  truefalse: 'True/False',
  short: 'Short answer',
};

export const ARTIFACT_KIND_LABELS: Record<ArtifactKind, string> = {
  summary: 'Summary',
  study_guide: 'Study guide',
  glossary: 'Glossary',
  mindmap: 'Mind map',
};

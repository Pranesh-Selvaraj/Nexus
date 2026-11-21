import { lazy } from 'react';

// KaTeX + syntax highlighting are large; keep them out of the main chunk and
// load the renderer the first time an answer or a card is displayed.
export const Markdown = lazy(() =>
  import('./Markdown').then((m) => ({ default: m.Markdown })),
);

/** Plain-text stand-in while the renderer chunk loads. */
export function MarkdownFallback({ content }: { content: string }) {
  return <span className="whitespace-pre-wrap">{content}</span>;
}

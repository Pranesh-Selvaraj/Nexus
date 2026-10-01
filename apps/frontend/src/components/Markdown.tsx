import { memo, useRef, useState, type ComponentPropsWithoutRef } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';

import 'katex/dist/katex.min.css';
import 'highlight.js/styles/github-dark.css';

/**
 * Shared Markdown renderer for chat answers.
 *
 * GFM (tables, task lists) + KaTeX math + syntax highlighting, with a copy
 * button on code blocks and safe external links. Memoized so completed
 * messages are not re-rendered while another message streams.
 */
export const Markdown = memo(function Markdown({
  content,
}: {
  content: string;
}) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[rehypeKatex, rehypeHighlight]}
      components={{
        a: ({ node: _node, ...props }) => (
          <a
            {...props}
            target="_blank"
            rel="noopener noreferrer"
            className="text-nexus-300 underline underline-offset-2"
          />
        ),
        img: ({ node: _node, ...props }) => (
          <img {...props} loading="lazy" className="my-2 max-w-full rounded" />
        ),
        pre: CodeBlock,
      }}
    >
      {content}
    </ReactMarkdown>
  );
});

function CodeBlock({
  node: _node,
  children,
  ...props
}: ComponentPropsWithoutRef<'pre'> & { node?: unknown }) {
  const ref = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);

  function copy(): void {
    const text = ref.current?.textContent ?? '';
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <div className="group relative">
      <pre ref={ref} {...props}>
        {children}
      </pre>
      <button
        type="button"
        onClick={copy}
        aria-label="Copy code"
        className="absolute right-2 top-2 rounded border border-zinc-700 bg-zinc-900/90 px-2 py-1 text-[10px] text-zinc-400 opacity-0 transition-opacity hover:text-zinc-200 focus:opacity-100 group-hover:opacity-100"
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Last-resort error boundary: a render error anywhere in the app shows a
 * recoverable fallback instead of a blank white screen. Errors are logged
 * for diagnosis; the reload button recovers by remounting the tree.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(
      '[nexus] unhandled render error:',
      error,
      info.componentStack,
    );
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children;

    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 bg-zinc-950 px-6 text-center text-zinc-400">
        <div className="text-4xl" aria-hidden>
          ⚠️
        </div>
        <div>
          <h1 className="text-lg font-semibold text-zinc-200">
            Something went wrong
          </h1>
          <p className="mt-1 max-w-md text-sm">
            The app hit an unexpected error. Reloading usually fixes it - if it
            keeps happening, check the server logs.
          </p>
        </div>
        {import.meta.env.DEV && (
          <pre className="max-w-lg truncate rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-left text-xs text-red-400">
            {this.state.error.message}
          </pre>
        )}
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-500"
        >
          Reload app
        </button>
      </div>
    );
  }
}

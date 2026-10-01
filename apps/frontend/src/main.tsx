import {
  MutationCache,
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query';
import React from 'react';
import { createRoot } from 'react-dom/client';

import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ToastProvider } from './components/Toast';
import { createTrpcClient, trpc } from './lib/trpc';
import { emitUnauthorized, isUnauthorizedError } from './lib/session';
import './styles/globals.css';

/** Session expiry anywhere in the app routes back to the login screen. */
function handleGlobalError(error: unknown): void {
  if (isUnauthorizedError(error)) emitUnauthorized();
}

const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: handleGlobalError }),
  mutationCache: new MutationCache({ onError: handleGlobalError }),
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 5_000,
    },
  },
});

const trpcClient = createTrpcClient();

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <trpc.Provider client={trpcClient} queryClient={queryClient}>
          <ToastProvider>
            <App />
          </ToastProvider>
        </trpc.Provider>
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);

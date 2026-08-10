import { httpBatchLink, splitLink } from '@trpc/client';
import { createWSClient, wsLink } from '@trpc/client/links/wsLink';
import { createTRPCReact } from '@trpc/react-query';

import type { AppRouter } from '@nexus/backend';

export const trpc = createTRPCReact<AppRouter>();

function getWsUrl(): string {
  const { protocol, host } = window.location;
  return `${protocol === 'https:' ? 'wss' : 'ws'}://${host}/ws`;
}

export function createTrpcClient() {
  return trpc.createClient({
    links: [
      splitLink({
        condition: (op) => op.type === 'subscription',
        true: wsLink({
          client: createWSClient({ url: getWsUrl }),
        }),
        false: httpBatchLink({ url: '/trpc' }),
      }),
    ],
  });
}
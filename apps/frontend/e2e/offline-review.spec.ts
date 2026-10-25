import { expect, test } from '@playwright/test';

/**
 * PWA + offline review (P-8).
 *
 * Verifies that the app is installable (manifest + registered service worker),
 * that a due card can be reviewed with the network off, and that the rating is
 * queued locally and synced to the API once the connection returns.
 */
test('pwa: installable shell and offline review that syncs', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const apiPort = process.env.E2E_API_PORT ?? '3000';
  const api = `http://127.0.0.1:${apiPort}`;

  await page.goto('/');

  // --- installability -----------------------------------------------------
  const manifest = await page.request.get('/manifest.webmanifest');
  expect(manifest.ok()).toBeTruthy();
  const manifestJson = (await manifest.json()) as {
    name?: string;
    icons?: Array<{ src: string; sizes: string }>;
  };
  expect(manifestJson.name).toContain('Nexus');
  expect(manifestJson.icons?.some((icon) => icon.sizes === '512x512')).toBe(
    true,
  );
  const swRegistered = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return false;
    const registration = await navigator.serviceWorker.getRegistration();
    return Boolean(registration);
  });
  expect(swRegistered).toBe(true);

  // --- workspace + one due card ------------------------------------------
  // The database is reused between runs, so the name must be unique: looking
  // up by name would otherwise pick a workspace from a previous run.
  const workspaceName = `Offline Review E2E ${Date.now()}`;
  await page.getByRole('button', { name: 'New workspace' }).click();
  await page.getByPlaceholder('Workspace name').fill(workspaceName);
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(
    page.getByRole('button', { name: new RegExp(workspaceName) }).first(),
  ).toBeVisible();

  const workspaces = (await (
    await page.request.get(`${api}/trpc/workspace.list`)
  ).json()) as { result: { data: Array<{ id: string; name: string }> } };
  const workspaceId = workspaces.result.data.find(
    (workspace) => workspace.name === workspaceName,
  )?.id;
  expect(workspaceId).toBeTruthy();

  const deck = (await (
    await page.request.post(`${api}/trpc/study.decks.create`, {
      data: { workspaceId, name: 'Offline deck' },
    })
  ).json()) as { result: { data: { id: string } } };
  const deckId = deck.result.data.id;
  const card = (await (
    await page.request.post(`${api}/trpc/study.cards.create`, {
      data: {
        deckId,
        front: 'Offline question',
        back: 'Offline answer',
      },
    })
  ).json()) as { result: { data: { id: string } } };
  const cardId = card.result.data.id;

  // The card must be due in the workspace the UI has open; otherwise the test
  // would be reviewing a different workspace's session.
  const due = (await (
    await page.request.get(
      `${api}/trpc/study.cards.due?input=${encodeURIComponent(
        JSON.stringify({ workspaceId, limit: 20 }),
      )}`,
    )
  ).json()) as { result: { data: Array<{ id: string }> } };
  expect(due.result.data.some((entry) => entry.id === cardId)).toBe(true);

  // --- review it with the network off ------------------------------------
  await page.getByRole('button', { name: 'study', exact: true }).click();
  await page.getByRole('button', { name: 'Review', exact: true }).click();
  await expect(page.getByText('Offline question')).toBeVisible({
    timeout: 20_000,
  });

  await page.context().setOffline(true);
  await page.keyboard.press('Space');
  await expect(page.getByText('Offline answer')).toBeVisible();
  // Keyboard shortcut 3 = Good; the button's accessible name includes the
  // interval preview ("Good 3 · 2d"), so the key is the stable selector.
  await page.keyboard.press('3');

  await expect(
    page.getByText(/Offline — reviews are saved on this device/),
  ).toBeVisible({ timeout: 10_000 });
  // The client retries once before surfacing the network error, so the queue
  // is populated a moment after the rating, not synchronously.
  await expect
    .poll(
      async () =>
        page.evaluate(
          () =>
            JSON.parse(localStorage.getItem('nexus.reviewQueue.v1') ?? '[]')
              .length,
        ),
      { timeout: 20_000 },
    )
    .toBe(1);
  const queued = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('nexus.reviewQueue.v1') ?? '[]'),
  );
  expect(queued[0].cardId).toBe(cardId);

  // --- reconnect: the queue flushes and the card is rescheduled ----------
  await page.context().setOffline(false);
  await expect
    .poll(
      async () =>
        page.evaluate(
          () =>
            JSON.parse(localStorage.getItem('nexus.reviewQueue.v1') ?? '[]')
              .length,
        ),
      { timeout: 30_000 },
    )
    .toBe(0);

  await expect
    .poll(
      async () => {
        const response = await page.request.get(
          `${api}/trpc/study.cards.due?input=${encodeURIComponent(
            JSON.stringify({ workspaceId, limit: 20 }),
          )}`,
        );
        const body = (await response.json()) as {
          result: { data: Array<{ id: string }> };
        };
        return body.result.data.some((due) => due.id === cardId);
      },
      { timeout: 30_000 },
    )
    .toBe(false);
});

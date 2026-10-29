import { expect, test } from '@playwright/test';

/**
 * Domain packs (L-14): install a curated pack from the Topics gallery, land in
 * the new topic, see the starter questions and the plan note, and find the
 * starter deck in Practice.
 */
test('packs: install a domain pack and start learning from it', async ({
  page,
}) => {
  const apiPort = process.env.E2E_API_PORT ?? '3000';
  const api = `http://127.0.0.1:${apiPort}`;
  // The database is reused between runs: remove any pack topic left behind so
  // the gallery shows "Install pack" rather than "Open topic".
  await page.goto('/');
  const workspaces = (await (
    await page.request.get(`${api}/trpc/workspace.list`)
  ).json()) as {
    result: {
      data: Array<{ id: string; metadata?: { packId?: string } | null }>;
    };
  };
  for (const workspace of workspaces.result.data) {
    if (workspace.metadata?.packId === 'tech-python-foundations') {
      await page.request.post(`${api}/trpc/workspace.delete`, {
        data: { workspaceId: workspace.id },
      });
    }
  }
  await page.reload();
  await page.getByRole('button', { name: 'Topics', exact: true }).click();

  const gallery = page.getByRole('region', { name: 'Domain packs' });
  await expect(gallery).toBeVisible();
  await expect(gallery.getByText('Python foundations')).toBeVisible();

  await gallery
    .getByRole('article')
    .filter({ hasText: 'Python foundations' })
    .getByRole('button', { name: 'Install pack' })
    .click();

  // The install opens the new topic with the pack icon and starter questions.
  await expect(
    page.getByRole('heading', { level: 1, name: 'Python foundations' }).first(),
  ).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Try asking')).toBeVisible();
  await expect(
    page.getByRole('button', {
      name: 'Explain the difference between a list and a tuple with examples.',
    }),
  ).toBeVisible();

  // Practice -> Notes holds the plan; Decks holds the starter deck.
  await page.getByRole('button', { name: 'Practice' }).click();
  await page.getByRole('button', { name: 'Notes', exact: true }).click();
  await expect(
    page.getByText('A week of Python fundamentals').first(),
  ).toBeVisible({
    timeout: 20_000,
  });

  await page.getByRole('button', { name: 'Decks' }).click();
  await expect(page.getByText('Python foundations · starter deck')).toBeVisible(
    {
      timeout: 20_000,
    },
  );
  await expect(page.getByText(/6 cards/).first()).toBeVisible();
});

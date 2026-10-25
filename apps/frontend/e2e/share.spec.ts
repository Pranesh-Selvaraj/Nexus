import { expect, test } from '@playwright/test';

/**
 * Read-only share link (L-13): the capability URL opens without a session,
 * shows the workspace, answers questions, and is revoked from the owner's
 * dialog.
 */
test('share: capability link opens read-only and can be revoked', async ({
  page,
}) => {
  const apiPort = process.env.E2E_API_PORT ?? '3000';
  const api = `http://127.0.0.1:${apiPort}`;

  // Workspace with one indexed document, created directly through the API.
  const workspaceName = `Shared E2E ${Date.now()}`;
  const workspace = (await (
    await page.request.post(`${api}/trpc/workspace.create`, {
      data: { name: workspaceName },
    })
  ).json()) as { result: { data: { id: string } } };
  const workspaceId = workspace.result.data.id;

  const upload = await page.request.post(`${api}/api/upload`, {
    multipart: {
      workspaceId,
      file: {
        name: 'shared-notes.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from(
          'Hybrid retrieval combines vector similarity with keyword search. '.repeat(
            10,
          ),
        ),
      },
    },
  });
  expect(upload.ok()).toBeTruthy();
  for (let i = 0; i < 30; i++) {
    const list = (await (
      await page.request.get(
        `${api}/trpc/document.listByWorkspace?input=${encodeURIComponent(
          JSON.stringify({ workspaceId }),
        )}`,
      )
    ).json()) as { result: { data: Array<{ status: string }> } };
    if (list.result.data[0]?.status === 'ready') break;
    await page.waitForTimeout(1_000);
  }

  const share = (await (
    await page.request.post(`${api}/trpc/share.create`, {
      data: { workspaceId, label: 'e2e share', expiresInDays: 7 },
    })
  ).json()) as { result: { data: { url: string; id: string } } };
  const token = share.result.data.url.split('/share/')[1];
  expect(token).toMatch(/^nxs_/);

  // The public page renders without logging in.
  await page.goto(`/share/${token}`);
  await expect(page.getByText('Shared workspace · read only')).toBeVisible();
  await expect(
    page.getByRole('heading', { name: workspaceName }),
  ).toBeVisible();
  await expect(page.getByText('shared-notes.txt')).toBeVisible();

  await page
    .getByPlaceholder('What does this material say about…?')
    .fill('What is hybrid retrieval?');
  await page.getByRole('button', { name: 'Ask' }).click();
  await expect(
    page.locator('p').filter({ hasText: 'Stub answer:' }).first(),
  ).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Sources', { exact: true })).toBeVisible();

  // Revoking invalidates the capability URL.
  const revoke = await page.request.post(`${api}/trpc/share.revoke`, {
    data: { id: share.result.data.id },
  });
  expect(revoke.ok()).toBeTruthy();
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'This link is not available' }),
  ).toBeVisible();
});

import { createServer, type Server } from 'node:http';

import { expect, test } from '@playwright/test';

/**
 * Phase 4a — ingestion and vision.
 *
 * Covers what the previous phases could not do: a library card for an image
 * with its detected format, vision analysis of that image (diagram mode),
 * attaching the image to a chat turn so the answer cites it, and importing a
 * web article by URL. Runs against the mock OpenAI stub, which answers image
 * requests deterministically per mode.
 *
 * The URL import talks to a local article server. The stack therefore runs
 * with `INGEST_ALLOW_PRIVATE_HOSTS=true` (see e2e-server.sh); the SSRF guard
 * itself is asserted against a strict instance in the backend smoke suite.
 */

/** 1x1 PNG — enough to exercise magic-byte detection and image serving. */
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const ARTICLE_PORT = 3210;

const ARTICLE_HTML = `<!doctype html>
<html><head><title>Hybrid Retrieval Explained</title></head>
<body>
  <nav><a href="/">Home</a><a href="/about">About</a></nav>
  <article>
    <h1>Hybrid Retrieval Explained</h1>
    ${Array.from(
      { length: 10 },
      (_unused, index) =>
        `<p>Paragraph ${index + 1}: hybrid retrieval fuses vector similarity with keyword search, and every fused candidate is cited in the answer.</p>`,
    ).join('\n    ')}
  </article>
  <footer>Footer links</footer>
</body></html>`;

let articleServer: Server | null = null;

test.beforeAll(async () => {
  articleServer = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(ARTICLE_HTML);
  });
  await new Promise<void>((resolve) =>
    articleServer?.listen(ARTICLE_PORT, () => resolve()),
  );
});

test.afterAll(async () => {
  await new Promise<void>((resolve) => {
    if (!articleServer) return resolve();
    articleServer.close(() => resolve());
  });
});

test('image ingestion, vision analysis, vision chat and url import', async ({
  page,
}) => {
  await page.goto('/');

  // --- workspace --------------------------------------------------------
  await page.getByRole('button', { name: 'New topic' }).click();
  await page
    .getByPlaceholder('e.g. Spanish B1, Linear algebra, Art history')
    .fill('E2E Ingestion');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'E2E Ingestion' }).first(),
  ).toBeVisible();

  // --- image upload: format comes from the bytes ------------------------
  const dropzoneInput = page.locator('input[type="file"][accept*=".png"]');
  await dropzoneInput.setInputFiles({
    name: `diagram-${Date.now()}.png`,
    mimeType: 'image/png',
    buffer: TINY_PNG,
  });

  const imageRow = page.locator('li', { hasText: 'diagram-' }).last();
  await expect(imageRow).toBeVisible();
  // The card shows the detected format badge and its thumbnail.
  await expect(imageRow.getByText('PNG', { exact: true })).toBeVisible();
  await expect(imageRow.locator('img')).toBeVisible();
  await expect(imageRow.getByText(/chunks? indexed/)).toBeVisible({
    timeout: 30_000,
  });

  // --- vision analysis (diagram mode) -----------------------------------
  await imageRow.getByRole('button', { name: 'Analyse image' }).click();
  const analysisDialog = page.getByRole('dialog', { name: /Analyse diagram-/ });
  await expect(analysisDialog).toBeVisible();
  await analysisDialog.getByRole('button', { name: 'Diagram' }).click();
  await analysisDialog.getByRole('button', { name: 'Run analysis' }).click();
  await expect(
    analysisDialog.getByText(/Components: two input boxes/),
  ).toBeVisible({ timeout: 30_000 });
  await analysisDialog
    .getByRole('button', { name: 'Close image analysis' })
    .click();
  await expect(analysisDialog).toBeHidden();

  // --- attach the image to a chat turn ----------------------------------
  await page.getByRole('button', { name: 'Attach an image' }).click();
  const picker = page.getByText('Attach an image from this workspace');
  await expect(picker).toBeVisible();
  await page
    .locator('button[aria-pressed]')
    .filter({ hasText: 'diagram-' })
    .first()
    .click();
  await expect(page.getByLabel('Vision')).toBeVisible();
  await page.getByLabel('Vision').selectOption('diagram');

  await page
    .getByPlaceholder(/Ask about the documents in/)
    .fill('What does this diagram show?');
  await page.keyboard.press('Enter');

  // The user turn renders the attached image…
  await expect(page.locator('img[alt="Attached image"]').first()).toBeVisible();
  // …and the answer comes from the vision path, citing the image.
  await expect(
    page.getByText(/Components: two input boxes/).first(),
  ).toBeVisible({ timeout: 30_000 });
  const sources = page.locator('details').filter({ hasText: 'diagram-' });
  await expect(sources.first()).toBeVisible();
  await sources.first().locator('summary').click();
  await expect(
    page
      .getByText(/Attached image - its indexed description is source/)
      .first(),
  ).toBeVisible();

  // A reload keeps the attachment visible on the persisted user turn.
  await page.waitForTimeout(500);
  await page.reload();
  await page
    .getByRole('button', { name: /E2E Ingestion/ })
    .first()
    .click();
  const historyAside = page.locator('aside').filter({ hasText: 'History' });
  await historyAside
    .getByRole('button')
    .filter({ hasText: /message/ })
    .first()
    .click();
  await expect(page.locator('img[alt="Attached image"]').first()).toBeVisible({
    timeout: 15_000,
  });

  // --- url ingestion ----------------------------------------------------
  await page
    .getByPlaceholder('Paste an article or YouTube URL')
    .fill(`http://127.0.0.1:${ARTICLE_PORT}/hybrid-retrieval`);
  await page.getByRole('button', { name: 'Add URL' }).click();
  await expect(page.getByText(/Queued the article \(\d+ words\)/)).toBeVisible({
    timeout: 30_000,
  });

  const articleRow = page.locator('li', { hasText: 'Hybrid Retrieval' }).last();
  await expect(articleRow).toBeVisible();
  await expect(articleRow.getByText('MD', { exact: true })).toBeVisible();
  await expect(articleRow.getByText(/193 words/)).toBeVisible();
  await expect(articleRow.getByText(/chunks? indexed/)).toBeVisible({
    timeout: 30_000,
  });
  await expect(
    articleRow.getByRole('link', { name: /127\.0\.0\.1/ }),
  ).toBeVisible();

  // Re-importing the same URL is reported as already present.
  await page
    .getByPlaceholder('Paste an article or YouTube URL')
    .fill(`http://127.0.0.1:${ARTICLE_PORT}/hybrid-retrieval`);
  await page.getByRole('button', { name: 'Add URL' }).click();
  await expect(page.getByText(/already in this workspace/)).toBeVisible({
    timeout: 30_000,
  });
});

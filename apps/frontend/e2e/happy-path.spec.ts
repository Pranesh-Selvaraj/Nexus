import { expect, test } from '@playwright/test';

/**
 * Core happy path: create a workspace, upload a document, wait for the
 * worker to index it, then stream a chat answer grounded in it.
 *
 * Runs against the mock OpenAI stub (deterministic embeddings + a fixed
 * streamed answer), so assertions are stable in CI and locally.
 */
test('workspace -> upload -> index -> streamed chat answer', async ({
  page,
}) => {
  await page.goto('/');

  // Empty state before any workspace exists.
  await expect(page.getByText('Welcome to Nexus')).toBeVisible();

  // --- create a workspace ------------------------------------------------
  await page.getByRole('button', { name: 'New workspace' }).click();
  await page.getByPlaceholder('Workspace name').fill('E2E Workspace');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(
    page.getByRole('button', { name: /E2E Workspace/ }).first(),
  ).toBeVisible();

  // --- upload a document ------------------------------------------------
  const dropzoneInput = page.locator('input[type="file"][accept*=".txt"]');
  await dropzoneInput.setInputFiles({
    name: `e2e-notes-${Date.now()}.txt`,
    mimeType: 'text/plain',
    buffer: Buffer.from(
      'Nexus is a retrieval-augmented generation system. '.repeat(40),
    ),
  });

  // Upload lands in the document list immediately (status: processing).
  const docRow = page.locator('li', { hasText: 'e2e-notes-' }).last();
  await expect(docRow).toBeVisible();
  await expect(docRow.getByText(/chunks? indexed/)).toBeVisible({
    timeout: 30_000,
  });

  // --- chat with the document -------------------------------------------
  const question = 'What is Nexus?';
  await page.getByPlaceholder(/Ask about the documents in/).fill(question);
  await page.keyboard.press('Enter');

  // User message appears, then the stub streams its answer token by token.
  await expect(page.getByText(question)).toBeVisible();
  const answerParagraph = page
    .locator('p')
    .filter({ hasText: 'Stub answer: Nexus is a retrieval-augmented' });
  await expect(answerParagraph).toBeVisible({ timeout: 30_000 });

  // The streamed answer was persisted and the background title generator
  // (stub LLM) named the conversation - visible in the sidebar list.
  await expect(
    page.getByRole('button', { name: /Stub answer: Nexus/ }).first(),
  ).toBeVisible();

  // The workspace sidebar count reflects the indexed document (B-21).
  await expect(
    page.getByRole('button', { name: /E2E Workspace/ }).first(),
  ).toContainText('1 document');

  // The stub answer cites [1], so the first source is marked as cited.
  await expect(page.locator('summary').first()).toContainText('✓');

  // --- retrieval inspector ----------------------------------------------
  await page
    .getByRole('button', { name: 'Why these sources?' })
    .first()
    .click();
  const inspector = page.getByRole('dialog', {
    name: 'Retrieval inspector',
  });
  await expect(inspector).toBeVisible();
  await expect(inspector.getByText('Vector candidates')).toBeVisible();
  await expect(inspector.getByText('Candidates (')).toBeVisible();
  await inspector.getByRole('button', { name: 'Close inspector' }).click();
  await expect(inspector).toBeHidden();

  // --- feedback persists across reload ----------------------------------
  await page.getByRole('button', { name: 'Helpful answer' }).click();
  await page.waitForTimeout(500);
  await expect(page.getByText('Feedback failed')).toHaveCount(0);

  await page.reload();
  await page
    .getByRole('button', { name: /E2E Workspace/ })
    .first()
    .click();
  const historyAside = page.locator('aside').filter({ hasText: 'History' });
  await historyAside
    .getByRole('button')
    .filter({ hasText: /message/ })
    .first()
    .click();
  await expect(
    page.getByRole('button', { name: 'Helpful answer' }),
  ).toHaveClass(/text-emerald-400/);

  // --- study loop: generate cards, review one, save a highlight --------
  await page.getByRole('button', { name: 'Study' }).click();
  await page.getByRole('button', { name: 'Decks' }).click();
  await page.getByLabel('Document', { exact: true }).selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Generate' }).click();
  await expect(page.getByText(/Created 3 flashcards/)).toBeVisible({
    timeout: 15_000,
  });

  await page.getByRole('button', { name: 'Dashboard' }).click();
  await page.getByRole('button', { name: /Start review/ }).click();
  await expect(
    page.getByText('What does Nexus combine for retrieval?'),
  ).toBeVisible();
  await page.keyboard.press('Space');
  await expect(
    page.getByText(
      'Vector similarity and Postgres full-text search, fused by rank.',
    ),
  ).toBeVisible();
  await page.getByRole('button', { name: /Good/ }).click();

  // The selection toolbar saves a highlight into the study notes.
  await page.getByRole('button', { name: 'Chat' }).click();
  const answer = page
    .locator('p')
    .filter({ hasText: 'Stub answer: Nexus is a retrieval-augmented' })
    .first();
  await answer.selectText();
  await page.getByRole('button', { name: 'Highlight' }).click();
  await expect(page.getByText('Highlight saved')).toBeVisible({
    timeout: 10_000,
  });
});

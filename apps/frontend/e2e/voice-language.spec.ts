import { expect, test } from '@playwright/test';

// The flow exercises several slow endpoints (TTS synthesis, transcription,
// mining) end to end; the default 60s budget is too tight.
test.setTimeout(180_000);

/**
 * Phase 3 voice & language flows against the deterministic mock provider:
 * read-aloud with cached server audio, vocabulary mining into SRS cards,
 * dictation diff scoring, pronunciation feedback, CEFR estimates, and
 * push-to-talk voice chat with persisted transcripts.
 *
 * Dictation is forced to the server engine so the test does not depend on the
 * Web Speech API in headless Chromium; Playwright's fake media device (see
 * playwright.config.ts) supplies the recording to /api/transcribe.
 */
test('voice & language: read-aloud, mining, drills, CEFR and voice chat', async ({
  page,
}) => {
  // The flow exercises five panels and two recordings; the default 60 s budget
  // is too tight once server speech and transcription are involved.
  // Must be set before the app loads so `voice.config` returns it. Target the
  // API port directly: the Vite dev server binds only one address family on
  // some CI runners, while Express listens on all interfaces.
  const apiPort = process.env.E2E_API_PORT ?? '3000';
  const setting = await page.request.post(
    `http://127.0.0.1:${apiPort}/trpc/settings.update`,
    { data: { key: 'voice.sttMode', value: 'server' } },
  );
  expect(setting.ok()).toBeTruthy();

  await page.goto('/');

  // --- workspace ---------------------------------------------------------
  await page.getByRole('button', { name: 'New topic' }).click();
  await page
    .getByPlaceholder('e.g. Spanish B1, Linear algebra, Art history')
    .fill('Voice Language E2E');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Voice Language E2E' }).first(),
  ).toBeVisible();

  // --- ask a question so there is an answer to read aloud ----------------
  await page
    .getByPlaceholder(/Ask about the documents in/)
    .fill('What is Nexus?');
  await page.keyboard.press('Enter');
  const answer = page
    .locator('p')
    .filter({ hasText: 'Stub answer: Nexus is a retrieval-augmented' })
    .first();
  await expect(answer).toBeVisible({ timeout: 30_000 });

  // --- read aloud: server synthesis, cache, download, sentence list ------
  await page.getByRole('button', { name: 'Read aloud' }).first().click();
  await page.getByRole('button', { name: 'Play read-aloud' }).click();
  await expect(page.getByText('Server voice (cached)')).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByRole('link', { name: 'Download' })).toBeVisible();
  await expect(
    page.locator('ol li').filter({ hasText: 'Stub answer: Nexus' }).first(),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Stop', exact: true }).click();

  // --- language panel: mine vocabulary -> SRS cards ----------------------
  await page.getByRole('button', { name: 'Language', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Vocabulary' })).toBeVisible();
  await page.getByRole('button', { name: 'Mine vocabulary' }).click();
  await expect(page.getByText(/Added \d+ terms?/)).toBeVisible({
    timeout: 25_000,
  });
  await expect(page.getByText('fusionar')).toBeVisible();
  await expect(page.getByText('recuperación')).toBeVisible();

  // --- dictation diff scoring -------------------------------------------
  await page.getByRole('button', { name: 'Dictation', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Dictation' })).toBeVisible();
  const target = await page.getByLabel('Sentence').inputValue();
  await page.getByLabel('Your transcription').fill(target);
  await page.getByRole('button', { name: 'Check' }).click();
  await expect(page.getByText('100%', { exact: true })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByText(/words correct/)).toBeVisible();

  // --- pronunciation scoring (server transcription of a fake recording) --
  await page
    .getByRole('button', { name: 'Pronunciation', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Pronunciation' }),
  ).toBeVisible();
  await page.getByLabel('Target sentence').fill('the cat sat on the mat');
  // While recording the button is renamed "Stop dictation"; match both.
  const pronMic = page.getByRole('button', {
    name: /Dictate|Stop dictation/,
  });
  await pronMic.click();
  await page.waitForTimeout(1500);
  await pronMic.click();
  await expect(page.getByText('per-word average')).toBeVisible({
    timeout: 25_000,
  });

  // --- CEFR progress -----------------------------------------------------
  await page.getByRole('button', { name: 'Progress', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Language level' }),
  ).toBeVisible();
  await expect(page.getByText('Overall')).toBeVisible();
  await expect(page.getByText('reading')).toBeVisible();

  // --- voice chat: push-to-talk -> transcribe -> answer -> transcript ----
  await page.getByRole('button', { name: 'Voice', exact: true }).click();
  await expect(page.getByText('Talk to your tutor')).toBeVisible();
  const chatMic = page.getByRole('button', {
    name: /Dictate|Stop dictation/,
  });
  await chatMic.click();
  await page.waitForTimeout(1500);
  await chatMic.click();
  await expect(
    page.getByText(/What does Nexus combine for retrieval/),
  ).toBeVisible({ timeout: 30_000 });
  await expect(
    page
      .locator('div.whitespace-pre-wrap')
      .filter({ hasText: 'Stub answer: Nexus is a retrieval-augmented' }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(
    page.getByRole('button', { name: 'Continue in Chat' }),
  ).toBeVisible();
});

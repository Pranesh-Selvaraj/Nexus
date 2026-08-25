import { afterEach, describe, expect, it, vi } from 'vitest';

// Mock the DB so getSetting() can be exercised without Postgres. The chain
// is: db.select({...}).from(settings).where(...).limit(1)
const dbMock = vi.hoisted(() => ({
  select: vi.fn(),
}));

vi.mock('../db/index.js', () => ({ db: dbMock }));

import {
  getSetting,
  invalidateSettingsCache,
  updateSetting,
} from './settings.service.js';

function mockSelectResult(rows: { value: string; isSecret: boolean }[]) {
  const chain = {
    from: vi.fn(() => chain),
    where: vi.fn(() => chain),
    limit: vi.fn(async () => rows),
  };
  dbMock.select.mockReturnValue(chain);
  return chain;
}

/** listSettings() uses db.select().from() without where/limit. */
function mockListRows(
  rows: { key: string; value: string; isSecret: boolean }[],
) {
  dbMock.select.mockReturnValue({
    from: vi.fn(async () => rows),
  });
}

afterEach(() => {
  vi.clearAllMocks();
  invalidateSettingsCache();
  delete process.env.OPENAI_MODEL;
});

describe('settings read cache', () => {
  it('serves repeated reads from cache (single DB query)', async () => {
    const chain = mockSelectResult([]);

    await getSetting('openai.model');
    await getSetting('openai.model');
    await getSetting('openai.model');

    expect(chain.limit).toHaveBeenCalledTimes(1);
  });

  it('re-reads from the DB after invalidation', async () => {
    const chain = mockSelectResult([]);

    await getSetting('openai.model'); // cached (env fallback)
    invalidateSettingsCache('openai.model');
    await getSetting('openai.model'); // must hit the DB again

    expect(chain.limit).toHaveBeenCalledTimes(2);
  });

  it('reflects env changes after invalidation', async () => {
    mockSelectResult([]);
    expect(await getSetting('openai.model')).toBe('gpt-4o-mini');

    invalidateSettingsCache('openai.model');
    process.env.OPENAI_MODEL = 'gpt-4o';
    expect(await getSetting('openai.model')).toBe('gpt-4o');
  });

  it('updateSetting invalidates the key so the new value is served', async () => {
    mockSelectResult([]);
    expect(await getSetting('rag.topK')).toBe('6');

    const insertMock = {
      values: vi.fn(() => ({
        onConflictDoUpdate: vi.fn(async () => undefined),
      })),
    };
    const deleteMock = { where: vi.fn(() => ({ then: undefined })) };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (dbMock as any).insert = vi.fn(() => insertMock);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (dbMock as any).delete = vi.fn(() => deleteMock);

    // updateSetting() ends with listSettings() - full rows with keys.
    mockListRows([{ key: 'rag.topK', value: '8', isSecret: false }]);
    await updateSetting('rag.topK', '8');

    // A later getSetting() must hit the DB again (cache was invalidated)
    // and return the persisted value.
    mockSelectResult([{ value: '8', isSecret: false }]);
    expect(await getSetting('rag.topK')).toBe('8');
  });
});

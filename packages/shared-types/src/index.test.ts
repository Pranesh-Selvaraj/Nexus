import { describe, expect, it } from 'vitest';

import {
  chatStreamInputSchema,
  createWorkspaceInputSchema,
  updateWorkspaceInputSchema,
  workspaceIdSchema,
} from './index.js';

describe('workspace schemas', () => {
  it('trims workspace names before validating min length (regression #18)', () => {
    expect(createWorkspaceInputSchema.safeParse({ name: '   ' }).success).toBe(
      false,
    );
    expect(createWorkspaceInputSchema.safeParse({ name: '' }).success).toBe(
      false,
    );
    expect(
      createWorkspaceInputSchema.safeParse({ name: '  Research  ' }).data,
    ).toEqual({ name: 'Research' });
  });

  it('enforces length bounds', () => {
    expect(
      createWorkspaceInputSchema.safeParse({ name: 'x'.repeat(81) }).success,
    ).toBe(false);
    expect(
      createWorkspaceInputSchema.safeParse({
        name: 'ok',
        description: 'd'.repeat(241),
      }).success,
    ).toBe(false);
    expect(
      createWorkspaceInputSchema.safeParse({
        name: 'ok',
        description: '  trimmed  ',
      }).data,
    ).toEqual({ name: 'ok', description: 'trimmed' });
  });

  it('update schema requires a workspaceId uuid and allows partial fields', () => {
    expect(
      updateWorkspaceInputSchema.safeParse({ workspaceId: 'not-a-uuid' })
        .success,
    ).toBe(false);
    expect(
      updateWorkspaceInputSchema.safeParse({ workspaceId: 'bogus', name: 'x' })
        .success,
    ).toBe(false);
    const parsed = updateWorkspaceInputSchema.safeParse({
      workspaceId: '11111111-1111-4111-8111-111111111111',
      description: 'only this',
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.name).toBeUndefined();
    }
  });
});

describe('workspaceIdSchema', () => {
  it('accepts uuids and rejects everything else', () => {
    expect(
      workspaceIdSchema.safeParse({
        workspaceId: '11111111-1111-4111-8111-111111111111',
      }).success,
    ).toBe(true);
    expect(workspaceIdSchema.safeParse({ workspaceId: '' }).success).toBe(
      false,
    );
    expect(
      workspaceIdSchema.safeParse({ workspaceId: '../../etc/passwd' }).success,
    ).toBe(false);
    expect(workspaceIdSchema.safeParse({}).success).toBe(false);
  });
});

describe('chatStreamInputSchema', () => {
  it('requires a non-empty message', () => {
    expect(
      chatStreamInputSchema.safeParse({
        workspaceId: '11111111-1111-4111-8111-111111111111',
        message: '',
      }).success,
    ).toBe(false);
    expect(
      chatStreamInputSchema.safeParse({
        workspaceId: '11111111-1111-4111-8111-111111111111',
        message: 'hello',
      }).success,
    ).toBe(true);
  });

  it('defaults history to an empty array and caps it at 20', () => {
    const parsed = chatStreamInputSchema.safeParse({
      workspaceId: '11111111-1111-4111-8111-111111111111',
      message: 'hi',
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.history).toEqual([]);

    const tooMany = Array.from({ length: 21 }, () => ({
      role: 'user' as const,
      content: 'x',
    }));
    expect(
      chatStreamInputSchema.safeParse({
        workspaceId: '11111111-1111-4111-8111-111111111111',
        message: 'hi',
        history: tooMany,
      }).success,
    ).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';

import { ApiError, sendApiError, friendlyErrorMessage } from './errors.js';

describe('friendlyErrorMessage', () => {
  it('strips HTML from provider 404 pages', () => {
    const err = new Error(
      '404 <!DOCTYPE html><html><head><title>Not Found | opencode</title></head><body><h1>404 - Page Not Found</h1></body></html>',
    );
    const message = friendlyErrorMessage(err);
    expect(message).not.toContain('<');
    expect(message).toContain('404');
    expect(message.length).toBeLessThan(300);
  });

  it('falls back to a hint when only markup remains', () => {
    const message = friendlyErrorMessage(
      new Error('<!DOCTYPE html><html><body></body></html>'),
    );
    expect(message).toContain('HTML page');
    expect(message).toContain('base URL');
  });

  it('truncates very long messages', () => {
    const message = friendlyErrorMessage(new Error('x'.repeat(1000)));
    expect(message.length).toBeLessThanOrEqual(301);
    expect(message.endsWith('…')).toBe(true);
  });

  it('keeps plain messages intact', () => {
    expect(friendlyErrorMessage(new Error('Invalid API key.'))).toBe(
      'Invalid API key.',
    );
  });

  it('handles non-Error values', () => {
    expect(friendlyErrorMessage(undefined)).toBe('undefined');
  });

  it('appends the underlying network error code', () => {
    const err = new Error('Connection error.', {
      cause: { code: 'ECONNRESET' },
    });
    expect(friendlyErrorMessage(err)).toBe('Connection error. (ECONNRESET)');
  });
});

describe('sendApiError', () => {
  const fakeRes = () => {
    const calls: { status?: number; body?: unknown } = {};
    return {
      calls,
      res: {
        status(code: number) {
          calls.status = code;
          return { json: (body: unknown) => void (calls.body = body) };
        },
      },
    };
  };

  it('maps an ApiError onto its status and body', () => {
    const { res, calls } = fakeRes();
    expect(sendApiError(res, new ApiError('Not found', 404))).toBe(true);
    expect(calls).toEqual({ status: 404, body: { error: 'Not found' } });
  });

  it('declines everything else so the caller owns the fallback', () => {
    const { res, calls } = fakeRes();
    expect(sendApiError(res, new Error('boom'))).toBe(false);
    expect(calls).toEqual({});
  });
});

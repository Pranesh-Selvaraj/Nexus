import { describe, expect, it } from 'vitest';

import { estimateDurationMs, resolveSttLanguage } from './stt.service.js';
import { clampSpeed, resolveVoice } from './tts.service.js';

describe('resolveSttLanguage', () => {
  it('returns undefined for auto', () => {
    expect(resolveSttLanguage('auto')).toBeUndefined();
    expect(resolveSttLanguage('auto', 'auto')).toBeUndefined();
    expect(resolveSttLanguage('en-US', 'auto')).toBeUndefined();
  });

  it('prefers the requested language', () => {
    expect(resolveSttLanguage('en-US', 'es-ES')).toBe('es-ES');
  });

  it('falls back to the setting', () => {
    expect(resolveSttLanguage('en-US')).toBe('en-US');
  });
});

describe('estimateDurationMs', () => {
  it('estimates compressed and WAV durations differently', () => {
    expect(estimateDurationMs(16_000, 'audio/webm')).toBe(1000);
    expect(estimateDurationMs(32_000, 'audio/wav')).toBe(1000);
    expect(estimateDurationMs(0, 'audio/webm')).toBe(0);
  });
});

describe('resolveVoice', () => {
  it('accepts known voices and falls back to alloy', () => {
    expect(resolveVoice('nova')).toBe('nova');
    expect(resolveVoice('not-a-voice')).toBe('alloy');
    expect(resolveVoice(undefined)).toBe('alloy');
  });
});

describe('clampSpeed', () => {
  it('clamps to the supported range', () => {
    expect(clampSpeed(1.5)).toBe(1.5);
    expect(clampSpeed(0.1)).toBe(0.5);
    expect(clampSpeed(5)).toBe(2);
  });

  it('uses the fallback for missing/NaN', () => {
    expect(clampSpeed(undefined, 1.25)).toBe(1.25);
    expect(clampSpeed(Number.NaN, 1.25)).toBe(1.25);
  });
});

import { describe, expect, it } from 'vitest';

import { TINY_PNG } from './fixtures.test-utils.js';
import {
  assertAnalyzableImage,
  buildVisionPrompt,
  imageMetadata,
  resolveVisionProvider,
  toDataUrl,
  VISION_INSTRUCTIONS,
} from './vision.service.js';

describe('vision provider resolution', () => {
  it('falls back to the chat provider field by field', () => {
    expect(
      resolveVisionProvider({
        visionApiKey: '',
        visionBaseUrl: '',
        visionModel: '',
        chatApiKey: 'sk-chat',
        chatBaseUrl: 'https://chat.example/v1',
        chatModel: 'text-model',
      }),
    ).toEqual({
      apiKey: 'sk-chat',
      baseUrl: 'https://chat.example/v1',
      model: 'text-model',
    });

    expect(
      resolveVisionProvider({
        visionApiKey: 'sk-vision',
        visionBaseUrl: 'https://vision.example/v1',
        visionModel: 'vl-model',
        chatApiKey: 'sk-chat',
        chatBaseUrl: 'https://chat.example/v1',
        chatModel: 'text-model',
      }),
    ).toEqual({
      apiKey: 'sk-vision',
      baseUrl: 'https://vision.example/v1',
      model: 'vl-model',
    });
  });
});

describe('vision prompts', () => {
  it('has an instruction for every mode', () => {
    for (const mode of ['general', 'art', 'diagram', 'equation'] as const) {
      expect(VISION_INSTRUCTIONS[mode].length).toBeGreaterThan(40);
    }
    expect(VISION_INSTRUCTIONS.art).toContain('composition');
    expect(VISION_INSTRUCTIONS.diagram).toContain('label');
    expect(VISION_INSTRUCTIONS.equation).toContain('LaTeX');
  });

  it('includes the question and OCR context when present', () => {
    const prompt = buildVisionPrompt('art', {
      question: 'What is the focal point?',
      ocrText: 'MUSEUM LABEL',
      title: 'Starry Night',
    });
    expect(prompt).toContain('Starry Night');
    expect(prompt).toContain('MUSEUM LABEL');
    expect(prompt).toContain('What is the focal point?');
    // The learner's question comes before the extra observations.
    expect(prompt.indexOf('What is the focal point?')).toBeLessThan(
      prompt.indexOf('Answer that question'),
    );
  });
});

describe('image guards', () => {
  it('rejects unsupported MIME types and oversized images', () => {
    expect(() => assertAnalyzableImage(TINY_PNG, 'image/png', 5)).not.toThrow();
    expect(() => assertAnalyzableImage(TINY_PNG, 'image/svg+xml', 5)).toThrow(
      /PNG, JPEG, WebP and GIF/,
    );
    expect(() =>
      assertAnalyzableImage(TINY_PNG, 'image/png', 0.000001),
    ).toThrow(/above the/);
    expect(() =>
      assertAnalyzableImage(Buffer.alloc(0), 'image/png', 5),
    ).toThrow(/empty/);
  });

  it('builds a data URL and image metadata', () => {
    expect(toDataUrl(TINY_PNG, 'image/png')).toMatch(
      /^data:image\/png;base64,iVBOR/,
    );
    expect(
      imageMetadata({ format: 'png', ocr: true, vision: true }),
    ).toMatchObject({ format: 'png', kind: 'image', ocr: true, vision: true });
  });
});

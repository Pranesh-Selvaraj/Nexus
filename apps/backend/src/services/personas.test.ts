import { describe, expect, it } from 'vitest';

import { getPersona, PERSONA_IDS, PERSONAS } from './personas.js';

describe('personas', () => {
  it('has unique ids and a default persona', () => {
    expect(new Set(PERSONA_IDS).size).toBe(PERSONA_IDS.length);
    expect(PERSONA_IDS).toContain('default');
  });

  it('gives every non-default persona its own instruction', () => {
    for (const persona of PERSONAS) {
      if (persona.id === 'default') {
        expect(persona.systemPrompt).toBe('');
      } else {
        expect(persona.systemPrompt.length).toBeGreaterThan(20);
      }
    }
  });

  it('resolves personas by id and returns null for unknown/empty ids', () => {
    expect(getPersona('socratic')?.label).toContain('Socratic');
    expect(getPersona('default')?.id).toBe('default');
    expect(getPersona('nope')).toBeNull();
    expect(getPersona(undefined)).toBeNull();
    expect(getPersona('')).toBeNull();
  });
});

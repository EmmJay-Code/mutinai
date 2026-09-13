import { describe, expect, it } from 'vitest';
import { GLOSSARY, glossary } from '../src/glossary';

describe('glossary', () => {
  const entries = Object.entries(GLOSSARY);

  it('explains every term in one short sentence, so it fits a popover', () => {
    for (const [key, entry] of entries) {
      expect(key, 'keys are kebab-case so they can be used in markup and URLs').toMatch(/^[a-z][a-z0-9-]*$/);
      expect(entry.term.length, key).toBeGreaterThan(1);
      expect(entry.plain.endsWith('.'), `${key} reads as a sentence`).toBe(true);
      expect(entry.plain.length, `${key} stays short enough to read in place`).toBeLessThanOrEqual(160);
    }
  });

  it('never explains a term with the term itself', () => {
    for (const [key, entry] of entries) {
      const head = entry.term.split(/\s+/)[0]!.toLowerCase();
      expect(entry.plain.toLowerCase().startsWith(head), `${key} should not restate its own term first`).toBe(false);
    }
  });

  it('resolves entries by key', () => {
    expect(glossary('vram').term).toBe('VRAM');
  });
});

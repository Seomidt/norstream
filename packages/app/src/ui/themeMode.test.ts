import { describe, expect, it } from 'vitest';
import { DEFAULT_PLACE, placeByKey, resolveScheme } from './themeRules.js';

describe('resolveScheme', () => {
  const noon = new Date('2026-06-21T12:00:00Z');
  const night = new Date('2026-06-21T23:30:00Z');

  it('foelger solen som standard', () => {
    expect(resolveScheme('sun', 'dark', noon, DEFAULT_PLACE)).toBe('light');
    expect(resolveScheme('sun', 'light', night, DEFAULT_PLACE)).toBe('dark');
  });

  it('foelger telefonen, og moerkt naar telefonen ikke siger noget', () => {
    expect(resolveScheme('system', 'light', night, DEFAULT_PLACE)).toBe('light');
    expect(resolveScheme('system', 'dark', noon, DEFAULT_PLACE)).toBe('dark');
    expect(resolveScheme('system', null, noon, DEFAULT_PLACE)).toBe('dark');
  });

  it('kan laases', () => {
    expect(resolveScheme('dark', 'light', noon, DEFAULT_PLACE)).toBe('dark');
    expect(resolveScheme('light', 'dark', night, DEFAULT_PLACE)).toBe('light');
  });

  it('ukendt sted giver Aarhus', () => {
    expect(placeByKey('atlantis').key).toBe('aarhus');
    expect(placeByKey('koebenhavn').name).toBe('København');
  });
});

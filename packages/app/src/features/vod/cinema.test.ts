import { describe, expect, it } from 'vitest';
import { premiereLabel } from './premiere.js';

describe('premiereLabel', () => {
  it('skriver datoen kort og dansk', () => {
    expect(premiereLabel('2026-09-24')).toBe('24. sep.');
    expect(premiereLabel('2026-05-01')).toBe('1. maj');
    expect(premiereLabel(null)).toBe('');
    expect(premiereLabel('snart')).toBe('');
  });
});

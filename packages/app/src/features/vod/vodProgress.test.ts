import { describe, expect, it } from 'vitest';
import { vodProgressTime } from './vodProgress.js';

describe('tidsvisning for film og det aktuelle serieafsnit', () => {
  it('viser afspillet tid, filens fulde varighed og resttid', () => {
    expect(vodProgressTime(754.8, 7384)).toEqual({ elapsed: 754, duration: 7384, remaining: 6630 });
    expect(vodProgressTime(754.8, 2700)).toEqual({ elapsed: 754, duration: 2700, remaining: 1946 });
  });
  it('foelger resume, spoling tilbage og skift til et nyt afsnit', () => {
    expect(vodProgressTime(1200, 2700)?.remaining).toBe(1500);
    expect(vodProgressTime(900, 2700)?.remaining).toBe(1800);
    expect(vodProgressTime(0, 1800)).toEqual({ elapsed: 0, duration: 1800, remaining: 1800 });
  });
  it('venter paa reel varighed fremfor at vise NaN eller en falsk resttid', () => {
    for (const duration of [0, -1, NaN, Infinity]) expect(vodProgressTime(0, duration)).toBeNull();
    expect(vodProgressTime(NaN, 1800)).toBeNull();
  });
  it('afgraenser negative positioner og viser nul tilbage ved filens faktiske slutning', () => {
    expect(vodProgressTime(-5, 1800)?.elapsed).toBe(0);
    expect(vodProgressTime(1800.5, 1800.5)).toEqual({ elapsed: 1801, duration: 1801, remaining: 0 });
    expect(vodProgressTime(1900, 1800)?.remaining).toBe(0);
  });
});

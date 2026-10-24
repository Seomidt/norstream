import { expect, it } from 'vitest';
import { safeVodResume, vodResumeAt } from './vodResume.js';

it('sete titler genafspilles, ogsaa med ukendt varighed eller en gammel delvis position', () => {
  expect(vodResumeAt({ watched: true, positionSeconds: 600, durationSeconds: null })).toBeNull();
  expect(vodResumeAt({ watched: true, positionSeconds: 600, durationSeconds: 1800 })).toBeNull();
});
it('en slutposition uden set-markering starter ogsaa forfra', () => {
  expect(vodResumeAt({ watched: false, positionSeconds: 1799, durationSeconds: 1800 })).toBeNull();
});
it('afviser ugyldig fremdrift og tillader genoptagelse uden kendt varighed', () => {
  for (const position of [null, 0, -1, Infinity, NaN]) expect(safeVodResume(position, 1800)).toBeNull();
  expect(safeVodResume(600, null)).toBe(600);
  expect(safeVodResume(600, 0)).toBe(600);
  expect(safeVodResume(600, NaN)).toBe(600);
});

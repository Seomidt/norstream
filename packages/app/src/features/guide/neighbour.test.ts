import { describe, expect, it } from 'vitest';
import { neighbourIndex } from './layout.js';
import type { GuideCell } from './layout.js';

/** Celler med kun det neighbourIndex kigger paa: starttid (null = hul). */
function cell(key: string, startClock: string | null): GuideCell {
  return {
    key,
    programme:
      startClock === null
        ? null
        : { channelId: 'c', start: new Date(`2026-09-30T${startClock}:00`), stop: new Date(`2026-09-30T${startClock}:00`), title: key, description: null },
    state: 'past',
    weight: 10,
    clippedStart: false,
    clippedEnd: false,
  };
}

const ms = (clock: string): number => new Date(`2026-09-30T${clock}:00`).getTime();

describe('neighbourIndex', () => {
  // Brugerens billede (v353): vinduet 18:00–19:25 efter pil venstre fra
  // Regionalprogram 19:30, som ikke laengere er i vinduet.
  const row = [cell('18news', '18:00'), cell('goaften', '18:25'), cell('19news', '19:00')];

  it('pil venstre fra en udsendelse der er roeget ud: den sidste udsendelse foer den', () => {
    expect(neighbourIndex(row, -1, -1, ms('19:30'))).toBe(2);
  });

  it('pil hoejre fra en udsendelse der er roeget ud: den foerste udsendelse efter den', () => {
    expect(neighbourIndex(row, -1, 1, ms('17:50'))).toBe(0);
    expect(neighbourIndex(row, -1, 1, ms('18:10'))).toBe(1);
  });

  it('er udsendelsen stadig i vinduet, tages naboen ved siden af', () => {
    expect(neighbourIndex(row, 1, -1, ms('18:25'))).toBe(0);
    expect(neighbourIndex(row, 1, 1, ms('18:25'))).toBe(2);
    expect(neighbourIndex(row, 0, -1, ms('18:00'))).toBe(0);
    expect(neighbourIndex(row, 2, 1, ms('19:00'))).toBe(2);
  });

  it('et hul taeller som nabo, saa det ikke springes over', () => {
    const withGap = [cell('18news', '18:00'), cell('gap', null), cell('19news', '19:00')];
    expect(neighbourIndex(withGap, -1, -1, ms('19:00'))).toBe(1);
  });

  it('uden kendt tid: sidste celle ved venstre, foerste ved hoejre', () => {
    expect(neighbourIndex(row, -1, -1, null)).toBe(2);
    expect(neighbourIndex(row, -1, 1, null)).toBe(0);
    expect(neighbourIndex(row, -1, 0, null)).toBe(0);
    expect(neighbourIndex([], -1, -1, null)).toBe(-1);
  });
});

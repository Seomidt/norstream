import { describe, expect, it } from 'vitest';
import type { Programme } from '@norstream/core';
import {
  SIDE_BY_SIDE_MIN_WIDTH,
  dayContext,
  formatSpan,
  guideTopLayout,
  minutesLeft,
  relativeDay,
  upcoming,
  nowAndNext,
  progressRatio,
} from './nowNext.js';

const at = (h: number, m: number): Date => new Date(2026, 8, 8, h, m);
const prog = (title: string, start: Date, stop: Date): Programme => ({
  channelId: 'c1',
  title,
  description: null,
  start,
  stop,
});

const tva = prog('TVA', at(18, 30), at(18, 50));
const vejr = prog('Vores Vejr', at(18, 50), at(19, 0));
const aften = prog('Aftenshowet', at(19, 0), at(20, 0));

describe('nowAndNext', () => {
  it('finder det der sendes nu og det der foelger', () => {
    const result = nowAndNext([aften, vejr, tva], at(18, 45));
    expect(result.now?.title).toBe('TVA');
    expect(result.next?.title).toBe('Vores Vejr');
  });

  it('i et hul er nu tom, og naeste er det foerste der kommer', () => {
    const result = nowAndNext([aften], at(18, 45));
    expect(result.now).toBeNull();
    expect(result.next?.title).toBe('Aftenshowet');
  });

  it('sidste udsendelse har ingen naeste', () => {
    const result = nowAndNext([tva, vejr, aften], at(19, 30));
    expect(result.now?.title).toBe('Aftenshowet');
    expect(result.next).toBeNull();
  });

  it('uden programdata er begge tomme', () => {
    expect(nowAndNext([], at(18, 45))).toEqual({ now: null, next: null });
  });
});

describe('progressRatio', () => {
  it('er halvvejs midt i udsendelsen og klemt til 0–1 udenfor', () => {
    expect(progressRatio(tva, at(18, 40))).toBeCloseTo(0.5);
    expect(progressRatio(tva, at(18, 0))).toBe(0);
    expect(progressRatio(tva, at(20, 0))).toBe(1);
  });
});

describe('guideTopLayout', () => {
  it('telefon paa hoejkant stabler, brede skaerme deler', () => {
    expect(guideTopLayout(390)).toBe('stacked');
    expect(guideTopLayout(SIDE_BY_SIDE_MIN_WIDTH - 1)).toBe('stacked');
    expect(guideTopLayout(SIDE_BY_SIDE_MIN_WIDTH)).toBe('side');
    expect(guideTopLayout(1280)).toBe('side');
  });
});

describe('formatSpan', () => {
  it('skriver start og slut med bindestreg', () => {
    expect(formatSpan(tva)).toBe('18:30–18:50');
  });
});

describe('upcoming og minutesLeft', () => {
  const at = (h: number, m = 0) => new Date(2026, 8, 10, h, m);
  const p = (title: string, start: Date, stop: Date) => ({ id: title, channelId: 'c', title, description: null, start, stop });
  const list = [p('A', at(18), at(19)), p('B', at(19), at(20)), p('C', at(20), at(21)), p('D', at(21), at(22))];
  it('giver de naeste efter den der sendes nu', () => {
    expect(upcoming(list, at(19, 20), 2).map((x) => x.title)).toEqual(['C', 'D']);
    expect(upcoming(list, at(17), 2).map((x) => x.title)).toEqual(['A', 'B']);
  });
  it('taeller minutter tilbage', () => {
    expect(minutesLeft(list[1]!, at(19, 20))).toBe(40);
    expect(minutesLeft(list[0]!, at(19, 20))).toBe(0);
  });
});

describe('dayContext', () => {
  const now = new Date(2026, 8, 20, 12, 0); // lør 20. sep 2026
  it('er null for i dag', () => {
    expect(dayContext(new Date(2026, 8, 20, 9, 0), now)).toBeNull();
  });
  it('siger "i går" og "i morgen"', () => {
    expect(dayContext(new Date(2026, 8, 19, 23, 55), now)).toBe('i går');
    expect(dayContext(new Date(2026, 8, 21, 8, 0), now)).toBe('i morgen');
  });
  it('giver ugedag og dato laengere vaek', () => {
    expect(dayContext(new Date(2026, 8, 17, 20, 0), now)).toBe('tor 17. sep');
  });
});

describe('relativeDay', () => {
  const now = new Date(2026, 8, 20, 12, 0); // lør 20. sep 2026
  it('siger "i dag" for i dag (til forskel fra dayContext)', () => {
    expect(relativeDay(new Date(2026, 8, 20, 9, 0), now)).toBe('i dag');
  });
  it('siger "i går" og "i morgen"', () => {
    expect(relativeDay(new Date(2026, 8, 19, 23, 55), now)).toBe('i går');
    expect(relativeDay(new Date(2026, 8, 21, 8, 0), now)).toBe('i morgen');
  });
  it('giver ugedag og dato laengere vaek', () => {
    expect(relativeDay(new Date(2026, 8, 17, 20, 0), now)).toBe('tor 17. sep');
  });
});

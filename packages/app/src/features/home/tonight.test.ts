import { describe, expect, it } from 'vitest';
import type { Programme } from '@norstream/core';
import { clockRange, eveningWindow, pickTonight } from './tonight.js';

const at = (day: number, hour: number, minute = 0): Date => new Date(2026, 8, day, hour, minute);
const prog = (channelId: string, start: Date, stop: Date, title: string): Programme => ({
  channelId,
  title,
  description: null,
  start,
  stop,
});

describe('eveningWindow', () => {
  it('i aften indtil 22.15, derefter i morgen aften', () => {
    const today = eveningWindow(at(27, 15).getTime());
    expect(today.label).toBe('I aften');
    expect(new Date(today.from)).toEqual(at(27, 19, 45));
    expect(new Date(today.to)).toEqual(at(27, 22, 30));
    const late = eveningWindow(at(27, 22, 20).getTime());
    expect(late.label).toBe('I morgen aften');
    expect(new Date(late.from)).toEqual(at(28, 19, 45));
    // Lige efter midnat er det stadig "i aften" (samme dag).
    expect(eveningWindow(at(28, 0, 30).getTime()).label).toBe('I aften');
  });
});

describe('pickTonight', () => {
  const window = eveningWindow(at(27, 15).getTime());
  const programmes = [
    prog('dr1', at(27, 19, 30), at(27, 20), 'TV Avisen'),
    prog('dr1', at(27, 20), at(27, 21, 30), 'Fredagsfilm'),
    prog('dr1', at(27, 21, 30), at(27, 21, 40), 'Vejret'),
    prog('dr1', at(27, 21, 40), at(27, 23, 30), 'Sen film'),
    prog('tv2', at(27, 18), at(27, 22), 'Superliga: Brøndby - FCK'),
    prog('tv2', at(27, 22), at(27, 22, 30), 'Nyhederne'),
    prog('tv3', at(27, 23), at(28, 1), 'Natfilm'),
    prog('dr2', at(27, 21), at(27, 21, 10), 'Kort'),
  ];

  it('én udsendelse per kanal i favoritternes raekkefoelge: bedste sendetid, ellers den laengste', () => {
    const picked = pickTonight(programmes, ['tv2', 'dr1', 'dr3', 'tv3', 'dr2'], window);
    expect(picked.map((p) => `${p.channelId}:${p.title}`)).toEqual(['tv2:Superliga: Brøndby - FCK', 'dr1:Fredagsfilm']);
  });

  it('uden en udsendelse i bedste sendetid vinder den laengste i aftenen', () => {
    const picked = pickTonight([prog('x', at(27, 19), at(27, 20, 30), 'Serie'), prog('x', at(27, 21, 30), at(27, 22, 20), 'Dok')], ['x'], window);
    expect(picked[0]?.title).toBe('Serie');
  });
});

describe('clockRange', () => {
  it('skriver 20.00–21.30', () => {
    expect(clockRange(prog('x', at(27, 20), at(27, 21, 30), 't'))).toBe('20.00–21.30');
  });
});

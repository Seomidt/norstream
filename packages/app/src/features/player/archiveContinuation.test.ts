import { describe, expect, it } from 'vitest';
import { archiveContinuation } from './archiveContinuation.js';

const at = (hhmm: string): number => new Date(`2026-09-24T${hhmm}:00.000Z`).getTime();
const show = { start: new Date(at('20:00')), stop: new Date(at('21:00')) };

describe('archiveContinuation', () => {
  it('fortsaetter fra det punkt man naaede, naar arkivet sluttede midt i', () => {
    // Startet forfra kl. 20:30: arkivet gik til 20:30. Nu er klokken 21:10.
    const next = archiveContinuation(show, at('20:00'), 30 * 60, at('21:10'));
    expect(next).toEqual({ kind: 'continue', from: new Date(at('20:30')), seekSeconds: 0, minutes: 30 });
  });

  it('runder ned til hele minutter og spoler resten frem', () => {
    const next = archiveContinuation(show, at('20:00'), 30 * 60 + 42, at('21:10'));
    expect(next).toEqual({ kind: 'continue', from: new Date(at('20:30')), seekSeconds: 42, minutes: 30 });
  });

  it('regner fra det nye stykke, naar der allerede er fortsat én gang', () => {
    const next = archiveContinuation(show, at('20:30'), 10 * 60, at('21:10'));
    expect(next).toMatchObject({ kind: 'continue', from: new Date(at('20:40')), minutes: 20 });
  });

  it('skifter til live, naar live er indhentet og udsendelsen stadig sendes', () => {
    expect(archiveContinuation(show, at('20:00'), 40 * 60, at('20:40'))).toEqual({ kind: 'live' });
  });

  it('goer intet, naar udsendelsen er set til ende', () => {
    expect(archiveContinuation(show, at('20:00'), 59 * 60 + 45, at('22:00'))).toEqual({ kind: 'done' });
  });
});

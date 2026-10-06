import { describe, expect, it } from 'vitest';
import { archiveContinuation, archiveWindow, LIVE_EDGE_LAG_MS } from './archiveContinuation.js';

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

  it('beder aldrig om arkiv ud i fremtiden paa en udsendelse der stadig sendes (v347)', () => {
    // Kl. 20:30: arkivet gik til 20:10 (hentet kl. 20:11). Naeste stykke gaar
    // kun til lidt foer nu (20:28:30), ikke til udsendelsens slutning 21:00.
    const next = archiveContinuation(show, at('20:00'), 10 * 60, at('20:30'));
    expect(next).toEqual({ kind: 'continue', from: new Date(at('20:10')), seekSeconds: 0, minutes: 18 });
  });

  it('regner fra det nye stykke, naar der allerede er fortsat én gang', () => {
    const next = archiveContinuation(show, at('20:30'), 10 * 60, at('21:10'));
    expect(next).toMatchObject({ kind: 'continue', from: new Date(at('20:40')), minutes: 20 });
  });

  it('skifter til live, naar live er indhentet og udsendelsen stadig sendes', () => {
    expect(archiveContinuation(show, at('20:00'), 40 * 60, at('20:40'))).toEqual({ kind: 'live' });
  });

  it('goer intet, naar udsendelsen er set til ende', () => {
    expect(archiveContinuation(show, at('20:00'), 59 * 60 + 59, at('22:00'))).toEqual({ kind: 'done' });
  });

  it('afspiller de sidste 25 sekunder i stedet for at regne dem som faerdige', () => {
    expect(archiveContinuation(show, at('20:00'), 59 * 60 + 35, at('22:00')))
      .toEqual({ kind: 'continue', from: new Date(at('20:59')), seekSeconds: 35, minutes: 1 });
  });

  it('venter paa den sidste del af et program der sluttede for 30 sekunder siden', () => {
    expect(archiveContinuation(show, at('20:00'), 59 * 60, at('21:00') + 30_000)).toEqual({ kind: 'wait' });
    expect(archiveContinuation(show, at('20:00'), 59 * 60, at('21:00') + 90_000))
      .toEqual({ kind: 'continue', from: new Date(at('20:59')), seekSeconds: 0, minutes: 1 });
  });

  it('venter paa det naeste arkivminut i stedet for at gentage det samme eller springe til live', () => {
    expect(archiveContinuation(show, at('20:00'), 28 * 60 + 40, at('20:30'))).toEqual({ kind: 'wait' });
    expect(archiveContinuation(show, at('20:00'), 28 * 60 + 40, at('20:31')))
      .toEqual({ kind: 'continue', from: new Date(at('20:28')), seekSeconds: 40, minutes: 1 });
  });

  it('holder 90 s afstand efter afrunding, ogsaa i hver af minutternes 60 sekunder', () => {
    for (let second = 0; second < 60; second += 1) {
      const now = at('20:30') + second * 1000;
      const window = archiveWindow(show, show.start, 0, now)!;
      expect(window.from.getTime() + window.minutes * 60_000).toBeLessThanOrEqual(now - LIVE_EDGE_LAG_MS);
    }
  });

  it('lover ikke et arkiv ud i fremtiden naar udsendelsen netop er startet', () => {
    expect(archiveWindow(show, show.start, 0, at('20:01'))).toBeNull();
    expect(archiveWindow(show, show.start, 0, at('20:02'))).toBeNull();
    expect(archiveWindow(show, show.start, 0, at('20:02') + 30_000))
      .toEqual({ from: show.start, seekSeconds: 0, minutes: 1 });
  });

  it('tager programmets sekunder med i seek naar panelet runder starttiden ned', () => {
    const start = new Date(at('20:00') + 25_000);
    expect(archiveWindow({ ...show, start }, start, 320, at('22:00')))
      .toEqual({ from: show.start, seekSeconds: 345, minutes: 60 });
  });

  it('ser en hel igangvaerende times udsendelse uden huller eller gentagne minutter', () => {
    let now = at('20:10');
    let reached = show.start.getTime();
    let window = archiveWindow(show, show.start, 0, now)!;
    let requests = 1;
    for (let second = 0; second < 3600; second += 1) {
      reached += 1000;
      now += 1000;
      if (reached < window.from.getTime() + window.minutes * 60_000) continue;
      const next = archiveContinuation(show, window.from.getTime(), (reached - window.from.getTime()) / 1000, now);
      if (next.kind === 'done') {
        expect(reached).toBe(show.stop.getTime());
        break;
      }
      expect(next.kind).toBe('continue');
      if (next.kind !== 'continue') throw new Error('arkivets fremdrift gik i staa');
      expect(next.from.getTime() + next.seekSeconds * 1000).toBe(reached);
      window = next;
      requests += 1;
    }
    expect(reached).toBe(show.stop.getTime());
    expect(requests).toBeGreaterThan(1);
  });
});

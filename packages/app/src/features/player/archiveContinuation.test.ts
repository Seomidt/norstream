import { describe, expect, it } from 'vitest';
import { archiveContinuation, archivePlaybackBounds, archiveWindow, LIVE_EDGE_LAG_MS } from './archiveContinuation.js';

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

  it('starter naeste minut ved 120 s uden et helt minuts overlap fra en millisekunds afrunding', () => {
    for (const seconds of [120, 119.999, 119.999999, 120.000001]) {
      expect(archiveContinuation(show, at('20:00'), seconds, at('20:06')))
        .toEqual({ kind: 'continue', from: new Date(at('20:02')), seekSeconds: 0, minutes: 2 });
    }
  });

  it('bevarer reelle sekunder fra TV-loggen og springer ikke til stykkets bestilte slutminut', () => {
    expect(archiveContinuation(show, at('20:00'), 119.75, at('20:06')))
      .toMatchObject({ kind: 'continue', from: new Date(at('20:01')), seekSeconds: 59.75 });
    expect(archiveContinuation(show, at('20:01'), 154, at('20:08')))
      .toMatchObject({ kind: 'continue', from: new Date(at('20:03')), seekSeconds: 34 });
    expect(archiveContinuation(show, at('20:03'), 179, at('20:10')))
      .toMatchObject({ kind: 'continue', from: new Date(at('20:05')), seekSeconds: 59 });
    expect(archiveContinuation(show, at('20:00'), 596, at('20:22')))
      .toMatchObject({ kind: 'continue', from: new Date(at('20:09')), seekSeconds: 56 });
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

  it('flytter et langt resume til det rigtige arkivminut og bevarer programmets sekunder', () => {
    const start = new Date(at('20:00') + 25_000);
    expect(archiveWindow({ ...show, start }, start, 320, at('22:00')))
      .toEqual({ from: new Date(at('20:05')), seekSeconds: 45, minutes: 55 });
  });

  it('genoptager paa praecis samme absolutte sted ved alle 60 sekunder i et arkivminut', () => {
    for (let second = 0; second < 60; second += 1) {
      const seek = 320 + second + 0.946;
      const window = archiveWindow(show, show.start, seek, at('22:00'))!;
      expect(window.seekSeconds).toBeGreaterThanOrEqual(0);
      expect(window.seekSeconds).toBeLessThan(60);
      expect(window.from.getTime() + window.seekSeconds * 1000).toBe(show.start.getTime() + seek * 1000);
    }
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

describe('slutmargen efter programguiden', () => {
  const news = { start: new Date(at('18:00')), stop: new Date(at('18:20')) };

  it('fortsaetter TV2-loggens 17 min + 179.340 s forbi EPG-slut i stedet for done', () => {
    const bounds = archivePlaybackBounds(news);
    expect(archiveWindow(bounds, news.start, 0, at('18:19') + 8546))
      .toEqual({ from: news.start, seekSeconds: 0, minutes: 17 });
    expect(archiveContinuation(bounds, at('18:00'), 1020.379, at('18:36') + 10171))
      .toMatchObject({ kind: 'continue', from: new Date(at('18:17')), seekSeconds: 0.379, minutes: 17 });
    expect(archiveContinuation(bounds, at('18:17'), 179.340, at('18:39') + 8451))
      .toEqual({ kind: 'continue', from: new Date(at('18:19')), seekSeconds: 59.34, minutes: 16 });
    expect(archiveContinuation(bounds, at('18:19'), 960 - 0.66, at('18:55')))
      .toEqual({ kind: 'done' });
    expect(news.stop.getTime()).toBe(at('18:20'));
  });

  it('stopper ikke fordi udsendelsen slutter mens man ser den forsinket', () => {
    const bounds = archivePlaybackBounds(news);
    expect(archiveContinuation(bounds, at('18:00'), 60, at('18:20')))
      .toMatchObject({ kind: 'continue', from: new Date(at('18:01')) });
    expect(archiveContinuation(bounds, at('18:00'), 20 * 60, at('18:40')))
      .toMatchObject({ kind: 'continue', from: new Date(at('18:20')), minutes: 15 });
    expect(archiveContinuation(bounds, at('18:00'), 21 * 60, at('18:21')))
      .toEqual({ kind: 'wait' });
  });

  it('venter paa den sidste del af slutmargenen og bestiller aldrig fremtidige minutter', () => {
    const bounds = archivePlaybackBounds(news);
    expect(archiveContinuation(bounds, at('18:34'), 0, at('18:35'))).toEqual({ kind: 'wait' });
    for (let second = 0; second < 60; second += 1) {
      const now = at('18:22') + second * 1000;
      const window = archiveWindow(bounds, new Date(at('18:19')), 59.34, now);
      if (window !== null) expect(window.from.getTime() + window.minutes * 60_000).toBeLessThanOrEqual(now - LIVE_EDGE_LAG_MS);
    }
  });

  it('bevarer slutgraensen ved nye stykker uden at aendre EPG-programmet', () => {
    const bounds = archivePlaybackBounds(news, at('18:40'));
    const window = archiveWindow(bounds, new Date(at('18:24')), 59.34, at('18:50'))!;
    expect(window).toEqual({ from: new Date(at('18:24')), seekSeconds: 59.34, minutes: 16 });
    expect(archivePlaybackBounds(news, bounds.stop.getTime()).stop.getTime()).toBe(at('18:40'));
    expect(archiveContinuation(bounds, at('18:24'), 60, at('18:50')).kind).toBe('continue');
    expect(archivePlaybackBounds(news, NaN).stop.getTime()).toBe(at('18:35'));
    expect(news.stop.getTime()).toBe(at('18:20'));
  });
});

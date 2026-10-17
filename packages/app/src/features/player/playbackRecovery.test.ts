import { describe, expect, it } from 'vitest';
import { PlaybackRecovery } from './playbackRecovery.js';

describe('PlaybackRecovery', () => {
  it('ready og en ny arkiv-URL giver ikke uendelige genforsoeg', () => {
    const r = new PlaybackRecovery(2);
    for (const expected of [true, true, false]) {
      r.beginLoad();
      r.position(42, 1000, true); // seek til det sekund der froes
      r.position(42, 2000, true);
      expect(r.failure().retry).toBe(expected);
    }
  });

  it('to sekunders afspilning mellem udfald nulstiller ikke budgettet', () => {
    const r = new PlaybackRecovery(2);
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      r.beginLoad();
      for (let second = 0; second <= 2; second += 1) r.position(42 + second, second * 1000, true);
      expect(r.failure()).toEqual({ attempt, retry: attempt <= 2 });
    }
  });

  it('ti sekunders faktisk afspilning tillader senere netvaerksudfald at blive repareret', () => {
    const r = new PlaybackRecovery(2);
    r.failure(); r.failure();
    r.beginLoad();
    for (let second = 0; second <= 9; second += 1) r.position(42 + second, second * 1000, true);
    expect(r.failure()).toEqual({ attempt: 3, retry: false });
    r.beginLoad();
    for (let second = 0; second <= 10; second += 1) r.position(42 + second, second * 1000, true);
    expect(r.failure()).toEqual({ attempt: 1, retry: true });
  });

  it('pause, reklamespring og et forsinket interval er ikke stabil afspilning', () => {
    const r = new PlaybackRecovery(2);
    r.failure(); r.failure();
    r.position(0, 0, true);
    r.position(180, 1000, true); // spring 3 minutter
    r.position(190, 2000, false); // pause
    r.position(200, 30_000, true); // app i baggrunden
    expect(r.failure().retry).toBe(false);
  });

  it('samme absolutte ende efter et minut-seek taeller som ingen fremgang', () => {
    const r = new PlaybackRecovery();
    expect(r.ended(600 + 42)).toBe(true);
    expect(r.ended(600 + 42)).toBe(true);
    expect(r.ended(600 + 42)).toBe(false);
    // Et nyt stykke begyndende kl. :11 og 12 s ind har derimod leveret data.
    expect(r.ended(660 + 12)).toBe(true);
  });

  it('et nyt valg af kanal eller Start forfra har sit eget budget', () => {
    const r = new PlaybackRecovery();
    r.failure(); r.failure(); r.failure();
    r.ended(42); r.ended(42); r.ended(42);
    r.reset();
    expect(r.failure()).toEqual({ attempt: 1, retry: true });
    expect(r.ended(42)).toBe(true);
  });
});

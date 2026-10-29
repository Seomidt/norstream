import { describe, expect, it } from 'vitest';
import { LivePlaybackHealth, PlaybackRecovery } from './playbackRecovery.js';

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

describe('LivePlaybackHealth', () => {
  function session(r: LivePlaybackHealth, start: number, seconds: number) {
    r.beginLoad(); r.ready(0, start);
    for (let second = 0; second <= seconds; second += 1) r.position(second, start + second * 1000, true);
    return start + seconds * 1000;
  }
  it('husker minutlange EOF selv om ti sekunders fremdrift nulstiller det normale budget', () => {
    const health = new LivePlaybackHealth(); const recovery = new PlaybackRecovery();
    let at = session(health, 0, 48);
    expect(health.failure('eof', 48, at)).toEqual({ shortEnds: 1, escalate: false });
    expect(health.failure('idle', 48, at)).toEqual({ shortEnds: 1, escalate: false });
    at = session(health, at + 1500, 67);
    recovery.beginLoad(); for (let second = 0; second <= 67; second += 1) recovery.position(second, second * 1000, true);
    expect(recovery.failure().attempt).toBe(1);
    expect(health.failure('eof', 67, at)).toEqual({ shortEnds: 2, escalate: true });
  });
  it('tomme og gamle EOF samt brugerens pause taeller ikke som korte raske sessioner', () => {
    const r = new LivePlaybackHealth();
    r.beginLoad(); r.ready(0, 0);
    expect(r.failure('eof', 60, 60_000).shortEnds).toBe(0);
    session(r, 0, 48); r.suspend();
    expect(r.failure('idle', 48, 60_000).shortEnds).toBe(0);
    r.beginLoad(); r.ready(0, 60_000);
    expect(r.failure('eof', 48, 61_000).shortEnds).toBe(0);
  });
  it('bevarer bekraeftede sekunder naar native nulstiller uret foer EOF', () => {
    const r = new LivePlaybackHealth();
    let at = session(r, 0, 48);
    r.position(0, at, false);
    expect(r.failure('eof', 0, at)).toEqual({ shortEnds: 1, escalate: false });
    at = session(r, at + 1500, 67);
    r.position(0, at, true);
    expect(r.failure('idle', 0, at)).toEqual({ shortEnds: 2, escalate: true });
  });
  it('tre minutters stabil afspilning og et nyt kanalvalg rydder historikken', () => {
    const r = new LivePlaybackHealth();
    let at = session(r, 0, 48); r.failure('eof', 48, at);
    at = session(r, at + 1500, 181);
    expect(r.failure('eof', 181, at).shortEnds).toBe(0);
    at = session(r, at + 1500, 77);
    expect(r.failure('eof', 77, at).shortEnds).toBe(1);
    r.reset(); at = session(r, at + 1500, 78);
    expect(r.failure('eof', 78, at).shortEnds).toBe(1);
  });
  it('forbinder ikke et gammelt udfald med et nyt mere end ti minutter senere', () => {
    const r = new LivePlaybackHealth();
    let at = session(r, 0, 48); r.failure('eof', 48, at);
    at = session(r, at + 11 * 60_000, 67);
    expect(r.failure('eof', 67, at)).toEqual({ shortEnds: 1, escalate: false });
  });
});

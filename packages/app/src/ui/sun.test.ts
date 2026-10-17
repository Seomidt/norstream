import { describe, expect, it } from 'vitest';
import { isDaylight, nextSunChangeMs, sunTimes } from './sun.js';

const AARHUS = { lat: 56.16, lon: 10.2 };

function hhmm(ms: number | null): string {
  if (ms === null) return 'null';
  const d = new Date(ms);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

describe('sunTimes', () => {
  it('rammer Aarhus ved sommersolhverv inden for et par minutter (UTC)', () => {
    // Aarhus 21. juni: op ca. 04:30, ned ca. 22:10 dansk sommertid = 02:30 / 20:10 UTC.
    const times = sunTimes(new Date('2026-06-21T10:00:00Z'), AARHUS.lat, AARHUS.lon);
    expect(hhmm(times.sunriseMs)).toMatch(/^02:(2[6-9]|3[0-5])$/);
    expect(hhmm(times.sunsetMs)).toMatch(/^20:(0[5-9]|1[0-5])$/);
  });

  it('rammer Aarhus ved vintersolhverv', () => {
    // 21. december: op ca. 08:48, ned ca. 15:40 dansk tid = 07:48 / 14:40 UTC.
    const times = sunTimes(new Date('2026-12-21T10:00:00Z'), AARHUS.lat, AARHUS.lon);
    expect(hhmm(times.sunriseMs)).toMatch(/^07:(4[4-9]|5[0-2])$/);
    expect(hhmm(times.sunsetMs)).toMatch(/^14:(3[7-9]|4[0-5])$/);
  });

  it('kender midnatssol og polarnat', () => {
    expect(sunTimes(new Date('2026-06-21T10:00:00Z'), 78, 15).polarDay).toBe(true);
    expect(sunTimes(new Date('2026-06-21T10:00:00Z'), 78, 15).sunriseMs).toBeNull();
    expect(sunTimes(new Date('2026-12-21T10:00:00Z'), 78, 15).polarDay).toBe(false);
  });
});

describe('isDaylight og nextSunChangeMs', () => {
  it('er lyst midt paa dagen og moerkt om natten', () => {
    expect(isDaylight(new Date('2026-06-21T12:00:00Z'), AARHUS.lat, AARHUS.lon)).toBe(true);
    expect(isDaylight(new Date('2026-06-21T23:30:00Z'), AARHUS.lat, AARHUS.lon)).toBe(false);
    expect(isDaylight(new Date('2026-12-21T16:00:00Z'), AARHUS.lat, AARHUS.lon)).toBe(false);
  });

  it('naeste skift er solnedgangen om dagen og solopgangen om natten', () => {
    const noon = new Date('2026-06-21T12:00:00Z');
    const next = nextSunChangeMs(noon, AARHUS.lat, AARHUS.lon);
    expect(hhmm(next)).toMatch(/^20:(0[5-9]|1[0-5])$/);
    const night = new Date('2026-06-21T23:30:00Z');
    const dawn = new Date(nextSunChangeMs(night, AARHUS.lat, AARHUS.lon));
    expect(dawn.getUTCDate()).toBe(22);
    expect(hhmm(dawn.getTime())).toMatch(/^02:(2[6-9]|3[0-5])$/);
  });
});

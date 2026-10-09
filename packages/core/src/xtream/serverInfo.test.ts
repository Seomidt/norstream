import { describe, expect, it } from 'vitest';
import { panelOffsetFromServerInfo } from './serverInfo.js';

/** 2026-09-05 16:34:12 UTC. */
const EPOCH_SECONDS = 1788626052;

function serverInfo(timeNow: string, timestampNow: unknown = String(EPOCH_SECONDS)): unknown {
  return { server_info: { time_now: timeNow, timestamp_now: timestampNow } };
}

describe('panelOffsetFromServerInfo', () => {
  it('udleder +120 minutter for Europe/Amsterdam om sommeren', () => {
    // Panelets ur staar 18:34:12 mens verdens ur staar 16:34:12 UTC.
    expect(panelOffsetFromServerInfo(serverInfo('2026-09-05 18:34:12'))).toBe(120);
  });

  it('udleder 0 for et panel der koerer UTC', () => {
    expect(panelOffsetFromServerInfo(serverInfo('2026-09-05 16:34:12'))).toBe(0);
  });

  it('udleder negative offsets vest for UTC', () => {
    expect(panelOffsetFromServerInfo(serverInfo('2026-09-05 11:34:12'))).toBe(-300);
  });

  it('haandterer halve og kvarte timer', () => {
    expect(panelOffsetFromServerInfo(serverInfo('2026-09-05 22:04:12'))).toBe(330);
    expect(panelOffsetFromServerInfo(serverInfo('2026-09-06 00:19:12'))).toBe(465);
  });

  it('runder svartid vaek', () => {
    // To sekunders forsinkelse mellem panelets ur og dets tidsstempel maa
    // ikke blive til et skaevt offset.
    expect(panelOffsetFromServerInfo(serverInfo('2026-09-05 18:34:14'))).toBe(120);
  });

  it('accepterer timestamp_now som tal og tid uden sekunder', () => {
    expect(panelOffsetFromServerInfo(serverInfo('2026-09-05 18:34', EPOCH_SECONDS))).toBe(120);
  });

  it('returnerer null naar et af felterne mangler', () => {
    expect(panelOffsetFromServerInfo({ server_info: { time_now: '2026-09-05 18:34:12' } })).toBeNull();
    expect(panelOffsetFromServerInfo({ server_info: { timestamp_now: EPOCH_SECONDS } })).toBeNull();
    expect(panelOffsetFromServerInfo({ server_info: {} })).toBeNull();
  });

  it('fortolker ikke timezone-strengen alene', () => {
    // Bevidst: det ville kraeve Intl med vilkaarlig IANA-zone, som Hermes
    // ikke leverer paalideligt paa Android.
    expect(panelOffsetFromServerInfo({ server_info: { timezone: 'Europe/Amsterdam' } })).toBeNull();
  });

  it('returnerer null ved uforstaaelige vaerdier', () => {
    expect(panelOffsetFromServerInfo(serverInfo('i morgen'))).toBeNull();
    expect(panelOffsetFromServerInfo(serverInfo('2026-13-05 18:34:12'))).toBeNull();
    expect(panelOffsetFromServerInfo(serverInfo('2026-02-31 18:34:12'))).toBeNull();
    expect(panelOffsetFromServerInfo(serverInfo('2026-09-05 18:34:12', '0'))).toBeNull();
    expect(panelOffsetFromServerInfo(serverInfo('2026-09-05 18:34:12', 'nu'))).toBeNull();
  });

  it('afviser offsets uden for de rigtige tidszoners raekkevidde', () => {
    // Et ur der staar tre doegn forkert er ikke en tidszone; saa er noget
    // andet galt, og 0 er et bedre gaet end 4320 minutter.
    expect(panelOffsetFromServerInfo(serverInfo('2026-09-08 16:34:12'))).toBeNull();
  });

  it('taaler svar der slet ikke ligner server_info', () => {
    for (const raw of [null, undefined, 42, 'fejl', [], {}, { server_info: 'nej' }]) {
      expect(panelOffsetFromServerInfo(raw)).toBeNull();
    }
  });
});

import { describe, expect, it } from 'vitest';
import {
  SETTLE_MS,
  canRecord,
  describeRecording,
  expiresAt,
  formatBytes,
  readyAt,
  recordingAction,
} from './plan.js';
import type { RecordingState } from './plan.js';

const NOW = new Date('2026-09-06T20:00:00.000Z');
const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;

function input(overrides: Partial<Parameters<typeof recordingAction>[0]> = {}) {
  return {
    state: 'planned' as RecordingState,
    stopMs: NOW.getTime() - HOUR,
    archiveDays: 7,
    ...overrides,
  };
}

describe('recordingAction', () => {
  it('venter til udsendelsen er slut', () => {
    expect(recordingAction(input({ stopMs: NOW.getTime() + HOUR }), NOW)).toBe('wait');
  });

  it('venter stadig lige efter sidste minut', () => {
    // Arkivet skrives mens der sendes; den sidste bid er ikke paa plads endnu.
    expect(recordingAction(input({ stopMs: NOW.getTime() - 60_000 }), NOW)).toBe('wait');
  });

  it('henter naar der er gaaet lidt tid efter udsendelsen', () => {
    expect(recordingAction(input({ stopMs: NOW.getTime() - SETTLE_MS - 1000 }), NOW)).toBe(
      'fetch',
    );
  });

  it('proever igen efter en mislykket hentning', () => {
    expect(recordingAction(input({ state: 'failed' }), NOW)).toBe('fetch');
  });

  it('lader en igangvaerende hentning vaere', () => {
    // To hentninger ville skrive i den samme fil.
    expect(recordingAction(input({ state: 'downloading' }), NOW)).toBe('none');
  });

  it('rører ikke det der er faerdigt eller udloebet', () => {
    expect(recordingAction(input({ state: 'done' }), NOW)).toBe('none');
    expect(recordingAction(input({ state: 'expired' }), NOW)).toBe('none');
  });

  it('opgiver naar arkivet har smidt udsendelsen ud', () => {
    expect(recordingAction(input({ stopMs: NOW.getTime() - 8 * DAY }), NOW)).toBe('expire');
  });

  it('henter stadig lige inden fristen', () => {
    expect(recordingAction(input({ stopMs: NOW.getTime() - 7 * DAY + HOUR }), NOW)).toBe(
      'fetch',
    );
  });

  it('opgiver ogsaa en der fejlede og nu er for gammel', () => {
    // Ellers ville en doed optagelse blive proevet igen ved hver app-start,
    // for evigt, mod et arkiv der aldrig faar den tilbage.
    expect(
      recordingAction(input({ state: 'failed', stopMs: NOW.getTime() - 30 * DAY }), NOW),
    ).toBe('expire');
  });

  it('saetter ingen frist naar kanalen ikke oplyser en arkivlaengde', () => {
    expect(
      recordingAction(input({ archiveDays: 0, stopMs: NOW.getTime() - 30 * DAY }), NOW),
    ).toBe('fetch');
  });
});

describe('canRecord', () => {
  it('kraever baade arkivflag og en arkivlaengde', () => {
    expect(canRecord({ hasArchive: true, archiveDays: 7 })).toBe(true);
    expect(canRecord({ hasArchive: false, archiveDays: 7 })).toBe(false);
    // Flaget sat, men nul dage: der er intet at hente bagefter.
    expect(canRecord({ hasArchive: true, archiveDays: 0 })).toBe(false);
  });
});

describe('readyAt og expiresAt', () => {
  it('siger hvornaar den kan hentes', () => {
    expect(readyAt(NOW.getTime())).toEqual(new Date(NOW.getTime() + SETTLE_MS));
  });

  it('siger hvornaar arkivet slipper den', () => {
    expect(expiresAt(NOW.getTime(), 7)).toEqual(new Date(NOW.getTime() + 7 * DAY));
    expect(expiresAt(NOW.getTime(), 0)).toBeNull();
  });
});

describe('formatBytes', () => {
  it('skifter til GB naar tallet bliver stort', () => {
    expect(formatBytes(0)).toBe('0 MB');
    expect(formatBytes(240_000_000)).toBe('240 MB');
    expect(formatBytes(2_100_000_000)).toBe('2,1 GB');
  });
});

describe('describeRecording', () => {
  function rec(overrides: Record<string, unknown> = {}) {
    return {
      state: 'planned' as RecordingState,
      start: new Date(NOW.getTime() - 2 * HOUR),
      stop: new Date(NOW.getTime() - HOUR),
      archiveDays: 7,
      bytes: 0,
      error: null,
      ...overrides,
    };
  }

  it('siger hvornaar en kommende udsendelse hentes', () => {
    // "Bestilt" alene faar folk til at tro appen har glemt det.
    const stop = new Date(NOW.getTime() + 3 * HOUR);
    const text = describeRecording(rec({ stop }), NOW);
    expect(text).toContain('Hentes');
    expect(text).toMatch(/\d{2}:\d{2}/);
  });

  it('siger klar naar udsendelsen er sendt og ventetiden er ovre', () => {
    expect(describeRecording(rec(), NOW)).toBe('Klar til at blive hentet');
  });

  it('viser stoerrelsen naar filen ligger paa enheden', () => {
    expect(describeRecording(rec({ state: 'done', bytes: 1_500_000_000 }), NOW)).toBe(
      'På enheden · 1,5 GB',
    );
  });

  it('bruger fejlbeskeden naar der er en', () => {
    expect(
      describeRecording(rec({ state: 'failed', error: 'Prøv igen senere.' }), NOW),
    ).toBe('Prøv igen senere.');
  });

  it('har altid noget at sige, ogsaa uden fejlbesked', () => {
    for (const state of ['failed', 'expired', 'downloading', 'done'] as const) {
      expect(describeRecording(rec({ state }), NOW).length).toBeGreaterThan(0);
    }
  });
});

import { describe, expect, it } from 'vitest';
import { restartBlockFor, restartHint } from './restart.js';

describe('restartBlockFor', () => {
  it('giver null naar alt er paa plads', () => {
    expect(restartBlockFor(true, true, true)).toBeNull();
  });

  it('naevner arkivet foerst, for uden det hjaelper intet andet', () => {
    expect(restartBlockFor(false, false, false)).toBe('no-archive');
    expect(restartBlockFor(false, true, true)).toBe('no-archive');
  });

  it('peger paa dialekten naar arkivet er der men vejen til det ikke er', () => {
    expect(restartBlockFor(true, false, true)).toBe('no-dialect');
    // Ogsaa uden programdata: dialekten er den der kan probes igen, og uden
    // den ville "hent program" ikke fjerne spaerringen alligevel.
    expect(restartBlockFor(true, false, false)).toBe('no-dialect');
  });

  it('peger paa programdata naar kun de mangler', () => {
    expect(restartBlockFor(true, true, false)).toBe('no-epg');
  });
});

describe('restartHint', () => {
  it('tilbyder en udvej hvor der findes en', () => {
    expect(restartHint('no-dialect').action).toBe('Prøv igen');
    expect(restartHint('no-epg').action).toBe('Hent program');
  });

  it('lover ingenting naar kanalen slet ikke har arkiv', () => {
    // Der er ikke noget appen kan goere, og en knap der ikke virker er
    // vaerre end ingen knap.
    expect(restartHint('no-archive').action).toBeNull();
  });

  it('siger hvad der mangler paa dansk, uden teknik', () => {
    for (const block of ['no-archive', 'no-dialect', 'no-epg'] as const) {
      const { text } = restartHint(block);
      expect(text.length).toBeGreaterThan(10);
      expect(text).not.toMatch(/dialect|timeshift\.php|null|EPG-id/i);
    }
  });
});

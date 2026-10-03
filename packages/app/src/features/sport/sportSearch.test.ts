import { describe, expect, it } from 'vitest';
import {
  groupHits,
  isReplay,
  likePatterns,
  looksLikeSport,
  matchProgramme,
  normalizeText,
  queryTerms,
  todayEnd,
  whenLabel,
} from './sportSearch.js';
import type { ProgrammeRow } from './sportSearch.js';

describe('normalizeText / queryTerms', () => {
  it('uden accenter, med ø/æ/å skrevet ud', () => {
    expect(normalizeText('Brøndby – FC København')).toBe('brondby – fc kobenhavn');
    expect(normalizeText('Århus Ærø Malmö Atlético')).toBe('aarhus aero malmo atletico');
  });

  it('ord uden smaaord og dubletter', () => {
    expect(queryTerms('  Arsenal v Chelsea ')).toEqual(['arsenal', 'chelsea']);
    expect(queryTerms('AGF - FCK')).toEqual(['agf', 'fck']);
    expect(queryTerms('v')).toEqual(['v']);
    expect(queryTerms(' ')).toEqual([]);
  });
});

describe('matchProgramme', () => {
  it('hvert ord som begyndelsen af et ord', () => {
    expect(matchProgramme(['fc', 'kob'], 'Superliga: FC København - Brøndby', null)).toBe('title');
    expect(matchProgramme(['brondby'], 'Superliga: FC København - Brøndby', null)).toBe('title');
    expect(matchProgramme(['liv'], 'Olive og Popeye', null)).toBeNull();
  });

  it('beskrivelsen taeller med, men noteres', () => {
    expect(matchProgramme(['arsenal', 'chelsea'], 'Premier League', 'Live: Arsenal mod Chelsea fra Emirates')).toBe('description');
    expect(matchProgramme(['arsenal'], 'Premier League', null)).toBeNull();
    expect(matchProgramme([], 'x', null)).toBeNull();
  });
});

describe('isReplay', () => {
  it('genudsendelser og hoejdepunkter', () => {
    expect(isReplay('Arsenal v Chelsea (R)')).toBe(true);
    expect(isReplay('Superliga: Højdepunkter')).toBe(true);
    expect(isReplay('Premier League Highlights')).toBe(true);
    expect(isReplay('R. Madrid - Barcelona')).toBe(false);
    expect(isReplay('Arsenal v Chelsea')).toBe(false);
  });
});

describe('likePatterns', () => {
  it('vokaler som joker', () => {
    expect(likePatterns(['brondby', 'aarhus', 'fc', 'aa'])).toEqual(['%br%ndb%', '%rh%s%', '%fc%']);
  });
});

const H = 3_600_000;
const NOW = new Date(2026, 8, 27, 15, 0).getTime();
const row = (channelId: string, title: string, startH: number, lengthH = 2, description: string | null = null): ProgrammeRow => ({
  channelId,
  title,
  description,
  startMs: NOW + startH * H,
  stopMs: NOW + (startH + lengthH) * H,
});

describe('groupHits', () => {
  const rows = [
    row('uk1', 'Arsenal v Chelsea', 3),
    row('dk1', 'Arsenal v Chelsea', 3),
    row('uk2', 'Arsenal v Chelsea (R)', 20),
    row('uk3', 'Premier League', -1, 2, 'Live: Arsenal visit Leeds'),
    row('news', 'Nyhederne', -0.5, 1, 'Arsenal fyrer manageren'),
    row('uk1', 'Arsenal v Spurs', -5, 2),
  ];

  it('samler kampen paa tvaers af kanaler, favoritter foerst, live foerst', () => {
    const hits = groupHits(rows, ['arsenal'], {
      now: NOW,
      channelRank: (id) => (id === 'dk1' ? 0 : 10),
      descriptionChannels: new Set(['uk1', 'uk2', 'uk3', 'dk1']),
    });
    expect(hits.map((h) => [h.title, h.channelIds, h.live, h.replay])).toEqual([
      ['Premier League', ['uk3'], true, false],
      ['Arsenal v Chelsea', ['dk1', 'uk1'], false, false],
      ['Arsenal v Chelsea (R)', ['uk2'], false, true],
    ]);
    expect(hits[0]?.inTitle).toBe(false);
  });

  it('uden kanal-graense taeller beskrivelsen overalt', () => {
    const hits = groupHits(rows, ['arsenal'], { now: NOW });
    expect(hits.map((h) => h.title)).toContain('Nyhederne');
  });
});

describe('looksLikeSport', () => {
  it('paa navn eller kategori', () => {
    expect(looksLikeSport('TV3 Sport HD', null)).toBe(true);
    expect(looksLikeSport('UK: Sky Premier League', 'UK| ENTERTAINMENT')).toBe(true);
    expect(looksLikeSport('Kanal 5', 'DK| SPORT')).toBe(true);
    expect(looksLikeSport('DR1', 'DK| GENERAL')).toBe(false);
  });
});

describe('whenLabel / todayEnd', () => {
  it('live, i dag, i morgen, ugedag', () => {
    expect(whenLabel(NOW - H, NOW + H, NOW)).toBe('LIVE NU');
    expect(whenLabel(NOW + 6 * H, NOW + 8 * H, NOW)).toBe('Kl. 21.00');
    expect(whenLabel(NOW + 22.5 * H, NOW + 24 * H, NOW)).toBe('I morgen 13.30');
    // 27/9-2026 er en soendag; +3 dage er onsdag.
    expect(whenLabel(NOW + 72 * H, NOW + 74 * H, NOW)).toBe('Ons. 15.00');
  });

  it('i dag: til midnat, men mindst seks timer', () => {
    expect(todayEnd(NOW)).toBe(new Date(2026, 8, 28, 0, 0).getTime());
    const late = new Date(2026, 8, 27, 22, 0).getTime();
    expect(todayEnd(late)).toBe(late + 6 * H);
  });
});

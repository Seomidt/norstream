import { describe, expect, it } from 'vitest';
import type { StoredVodItem } from '../../storage/vod.js';
import { comparableTitle, pickPanelMatch } from './panelMatch.js';

function item(name: string): StoredVodItem {
  return {
    key: `s:${name}`,
    id: name,
    sourceId: 's',
    kind: 'movie',
    name,
    posterUrl: null,
    rating: null,
    categoryId: null,
    categoryName: null,
    addedMs: null,
    inWatchlist: false,
    positionSeconds: null,
    durationSeconds: null,
    foundPosterUrl: null,
    watched: false,
  } as unknown as StoredVodItem;
}

describe('comparableTitle', () => {
  it('ser bort fra tegnsaetning og store bogstaver', () => {
    expect(comparableTitle('Dune: Part Two')).toBe('dune part two');
    expect(comparableTitle('Fast & Furious')).toBe('fast og furious');
    expect(comparableTitle('  Klovn  ')).toBe('klovn');
  });
});

describe('pickPanelMatch', () => {
  const items = [item('DK - Dune (1984) [HD]'), item('DK - Dune (2021) 4K'), item('DK - Dune Part Two (2024)'), item('NF| Dunes of Sand')];

  it('finder titlen med det rigtige aarstal', () => {
    expect(pickPanelMatch(items, 'Dune', 2021)?.name).toBe('DK - Dune (2021) 4K');
    expect(pickPanelMatch(items, 'Dune: Part Two', 2024)?.name).toBe('DK - Dune Part Two (2024)');
  });

  it('tager den foerste naar der ikke er aarstal at gaa efter', () => {
    expect(pickPanelMatch(items, 'Dune', null)?.name).toBe('DK - Dune (1984) [HD]');
    expect(pickPanelMatch([item('NF| Klovn')], 'Klovn', 2010)?.name).toBe('NF| Klovn');
  });

  it('giver null naar aarstallet ikke passer, og naar navnet kun ligner', () => {
    expect(pickPanelMatch(items, 'Dune', 1999)).toBeNull();
    expect(pickPanelMatch(items, 'Dunes', null)).toBeNull();
  });
});

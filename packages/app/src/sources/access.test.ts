import { describe, expect, it } from 'vitest';
import { channelKey } from '@norstream/core';
import type { Source, XtreamCredentials } from '@norstream/core';
import { credentialsBySource, groupBySource, liveUrlFor } from './access.js';

const creds: XtreamCredentials = {
  baseUrl: 'http://panel.example:8080',
  username: 'USER',
  password: 'PASS',
};

function source(id: string, kind: Source['kind'] = 'xtream'): Source {
  return {
    id,
    kind,
    name: id,
    url: 'http://panel.example:8080',
    username: kind === 'xtream' ? 'USER' : null,
    xmltvUrl: null,
    enabled: true,
    sortOrder: 0,
  };
}

describe('groupBySource', () => {
  it('deler noegler op efter hvor de kommer fra', () => {
    const grouped = groupBySource([
      channelKey('a', '1'),
      channelKey('b', '1'),
      channelKey('a', '2'),
    ]);
    expect([...grouped.keys()].sort()).toEqual(['a', 'b']);
    expect(grouped.get('a')).toEqual(['a:1', 'a:2']);
  });

  it('springer noegler over der ikke er noegler', () => {
    // En gammel raekke fra foer kilderne fandtes maa ikke faa appen til at
    // spoerge et panel om en kanal det aldrig har haft.
    expect(groupBySource(['247634', '']).size).toBe(0);
  });
});

describe('liveUrlFor', () => {
  it('bruger M3U-kanalens egen adresse', () => {
    const url = liveUrlFor(
      { source: source('a', 'm3u'), creds: null },
      { streamId: 'dr1', streamUrl: 'http://liste.example/dr1.m3u8' },
      'ts',
    );
    expect(url).toBe('http://liste.example/dr1.m3u8');
  });

  it('bygger Xtream-kanalens adresse af kildens legitimation', () => {
    const url = liveUrlFor(
      { source: source('a'), creds },
      { streamId: '247634', streamUrl: null },
      'ts',
    );
    expect(url).toBe('http://panel.example:8080/live/USER/PASS/247634.ts');
  });

  it('giver null naar kilden er vaek', () => {
    // Kalderen skal sige det. En tom afspiller ser ud som en doed stream.
    expect(liveUrlFor(null, { streamId: '1', streamUrl: null }, 'ts')).toBeNull();
  });

  it('giver null for en Xtream-kanal uden legitimation', () => {
    expect(
      liveUrlFor({ source: source('a'), creds: null }, { streamId: '1', streamUrl: null }, 'ts'),
    ).toBeNull();
  });
});

describe('credentialsBySource', () => {
  it('tager kun de kilder der har legitimation med', () => {
    const map = credentialsBySource([
      { source: source('a'), creds },
      { source: source('b', 'm3u'), creds: null },
    ]);
    expect([...map.keys()]).toEqual(['a']);
  });
});

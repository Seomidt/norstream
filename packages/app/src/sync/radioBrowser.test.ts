import { describe, expect, it } from 'vitest';
import {
  fetchRadioCountries,
  fetchRadioStations,
  homepageIconUrl,
  isRadioKey,
  preferBestQuality,
  qualityKey,
  radioLogoUrls,
  searchRadioStations,
  sortCountries,
  toRadioChannel,
  toRadioStation,
} from './radioBrowser.js';
import type { RadioFetch } from './radioBrowser.js';

function fakeFetch(answers: Array<[RegExp, unknown]>): RadioFetch & { calls: string[] } {
  const calls: string[] = [];
  const impl = (async (url: string) => {
    calls.push(url);
    const hit = answers.find(([pattern]) => pattern.test(url));
    const body = hit === undefined ? [] : hit[1];
    return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
  }) as RadioFetch & { calls: string[] };
  impl.calls = calls;
  return impl;
}

const RAW = {
  stationuuid: 'u1',
  name: '  DR P3 ',
  url: 'http://live-icy.dr.dk/A/A05H.mp3',
  url_resolved: 'http://live-icy.dr.dk/A/A05H.mp3',
  favicon: 'https://dr.dk/p3.png',
  homepage: 'https://dr.dk/p3',
  countrycode: 'dk',
  votes: 120,
  codec: 'MP3',
  bitrate: 192,
  tags: 'pop,public radio, dansk',
};

describe('toRadioStation', () => {
  it('laeser en station og renser navnet', () => {
    expect(toRadioStation(RAW)).toEqual({
      id: 'u1',
      name: 'DR P3',
      country: 'DK',
      url: 'http://live-icy.dr.dk/A/A05H.mp3',
      logoUrl: 'https://dr.dk/p3.png',
      homepage: 'https://dr.dk/p3',
      votes: 120,
      codec: 'MP3',
      bitrate: 192,
      tags: ['pop', 'public radio', 'dansk'],
    });
  });

  it('afviser stationer uden adresse, og tager et tomt favicon som intet logo', () => {
    expect(toRadioStation({ ...RAW, url: 'rtsp://x', url_resolved: '' })).toBeNull();
    expect(toRadioStation({ ...RAW, favicon: '' })?.logoUrl).toBeNull();
    expect(toRadioStation({ ...RAW, name: '' })).toBeNull();
  });
});

describe('fetchRadioCountries', () => {
  it('saetter Norden foerst, saa dem med flest stationer, og udelader de smaa', async () => {
    const fetchImpl = fakeFetch([
      [
        /countrycodes/,
        [
          { name: 'US', stationcount: 9000 },
          { name: 'DE', stationcount: 4000 },
          { name: 'DK', stationcount: 80 },
          { name: 'IS', stationcount: 3 },
          { name: 'XX', stationcount: 2 },
          { name: '', stationcount: 50 },
        ],
      ],
    ]);
    const countries = await fetchRadioCountries(fetchImpl);
    expect(countries.map((c) => c.code)).toEqual(['DK', 'IS', 'US', 'DE']);
    expect(countries[0]).toMatchObject({ name: 'Danmark', flag: '🇩🇰', stations: 80 });
    expect(fetchImpl.calls[0]).toContain('order=stationcount');
  });

  it('sortCountries er stabil for lande uden for Norden', () => {
    const sorted = sortCountries([
      { code: 'FR', name: 'Frankrig', flag: '', stations: 100 },
      { code: 'SE', name: 'Sverige', flag: '', stations: 10 },
      { code: 'GB', name: 'Storbritannien', flag: '', stations: 100 },
    ]);
    expect(sorted.map((c) => c.code)).toEqual(['SE', 'FR', 'GB']);
  });
});

describe('fetchRadioStations og searchRadioStations', () => {
  it('henter landets stationer efter stemmer, uden dubletter', async () => {
    const fetchImpl = fakeFetch([[/bycountrycodeexact\/DK/, [RAW, RAW, { ...RAW, stationuuid: 'u2', name: 'P4' }]]]);
    const stations = await fetchRadioStations(fetchImpl, 'dk');
    expect(stations.map((s) => s.id)).toEqual(['u1', 'u2']);
    expect(fetchImpl.calls[0]).toContain('order=votes&reverse=true');
    expect(fetchImpl.calls[0]).toContain('hidebroken=true');
  });

  it('soeger paa navn, og spoerger ikke om ingenting', async () => {
    const fetchImpl = fakeFetch([[/stations\/search\?name=P3/, [RAW]]]);
    expect((await searchRadioStations(fetchImpl, ' P3 ')).map((s) => s.name)).toEqual(['DR P3']);
    expect(await searchRadioStations(fetchImpl, '  ')).toEqual([]);
    expect(fetchImpl.calls).toHaveLength(1);
  });

  it('giver tomt naar nettet fejler', async () => {
    const broken = (async () => {
      throw new Error('Network request failed');
    }) as unknown as RadioFetch;
    expect(await fetchRadioStations(broken, 'DK')).toEqual([]);
    expect(await fetchRadioCountries(broken)).toEqual([]);
  });
});

describe('toRadioChannel', () => {
  it('bliver en kanal med stationens egen adresse og en rb-noegle', () => {
    const station = toRadioStation(RAW);
    if (station === null) throw new Error('station');
    const channel = toRadioChannel(station);
    expect(channel.id).toBe('rb:u1');
    expect(channel.streamUrl).toBe('http://live-icy.dr.dk/A/A05H.mp3');
    expect(channel.logoUrls).toEqual(['https://dr.dk/p3.png', 'https://www.google.com/s2/favicons?domain=dr.dk&sz=128']);
    expect(channel.logoUrl).toBe('https://dr.dk/p3.png');
    expect(channel.hasArchive).toBe(false);
    expect(isRadioKey(channel.id)).toBe(true);
    expect(isRadioKey('src:12')).toBe(false);
  });
});

describe('radioLogoUrls', () => {
  it('registrets favicon foerst, hjemmesidens ikon som naeste', () => {
    expect(radioLogoUrls({ logoUrl: 'https://dr.dk/p3.png', homepage: 'https://www.dr.dk/p3' })).toEqual([
      'https://dr.dk/p3.png',
      'https://www.google.com/s2/favicons?domain=dr.dk&sz=128',
    ]);
  });

  it('uden favicon kun hjemmesidens ikon; uden begge intet', () => {
    expect(radioLogoUrls({ logoUrl: null, homepage: 'http://Radio-Sun.fi/' })).toEqual([
      'https://www.google.com/s2/favicons?domain=radio-sun.fi&sz=128',
    ]);
    expect(radioLogoUrls({ logoUrl: null, homepage: null })).toEqual([]);
  });

  it('afviser hjemmesider uden brugbart vaertsnavn', () => {
    expect(homepageIconUrl('ikke en adresse')).toBeNull();
    expect(homepageIconUrl('http://localhost/')).toBeNull();
  });
});

describe('qualityKey og preferBestQuality', () => {
  const st = (id: string, name: string, bitrate: number, votes = 0) => ({
    id,
    name,
    country: 'DK',
    url: `http://x/${id}`,
    logoUrl: null,
    homepage: null,
    votes,
    codec: 'MP3',
    bitrate,
    tags: [],
  });

  it('ser bort fra bitrate, codec og HQ i navnet', () => {
    expect(qualityKey('DR P3 192')).toBe(qualityKey('DR P3'));
    expect(qualityKey('DR P3 (AAC 96)')).toBe(qualityKey('dr p3'));
    expect(qualityKey('Radio Soft HQ')).toBe(qualityKey('Radio Soft'));
    expect(qualityKey('Radio 24syv')).not.toBe(qualityKey('Radio'));
    // Tal der ikke er bitrates er en del af navnet.
    expect(qualityKey('Radio 100')).not.toBe(qualityKey('Radio 208'));
    expect(qualityKey('Radio 100')).not.toBe(qualityKey('Radio'));
    expect(qualityKey('Skala FM 93.1')).not.toBe(qualityKey('Skala FM'));
  });

  it('beholder den med hoejest bitrate, paa den foerstes plads', () => {
    const list = [st('a', 'DR P3', 96, 900), st('b', 'Skala FM', 128, 500), st('c', 'DR P3 192', 192, 40)];
    expect(preferBestQuality(list).map((s) => s.id)).toEqual(['c', 'b']);
  });

  it('uden kendt bitrate beholdes den mest stemte (foerste)', () => {
    const list = [st('a', 'Radio X', 0, 900), st('b', 'Radio X HQ', 0, 40)];
    expect(preferBestQuality(list).map((s) => s.id)).toEqual(['a']);
  });
});

import { describe, expect, it } from 'vitest';
import {
  fetchRadioCountries,
  fetchRadioStations,
  isRadioKey,
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
    expect(channel.logoUrls).toEqual(['https://dr.dk/p3.png']);
    expect(channel.hasArchive).toBe(false);
    expect(isRadioKey(channel.id)).toBe(true);
    expect(isRadioKey('src:12')).toBe(false);
  });
});

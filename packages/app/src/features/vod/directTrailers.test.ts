import { describe, expect, it } from 'vitest';
import { directTitleAliases, findDirectTrailers, findImdbTitle, hlsTrailerSeconds, prepareDirectHls } from './directTrailers.js';
import { buildHlsMaster } from './trailerHls.js';

const master = '#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aac",URI="audio.m3u8",PATHWAY-ID="ap"\n' +
  '#EXT-X-STREAM-INF:BANDWIDTH=9000000,RESOLUTION=3840x2076,CODECS="hvc1,mp4a.40.2",AUDIO="aac"\n4k.m3u8\n' +
  '#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1038,CODECS="avc1.640028,mp4a.40.2",AUDIO="aac",PATHWAY-ID="ap"\nvideo.m3u8\n' +
  '#EXT-X-STREAM-INF:BANDWIDTH=500000,RESOLUTION=640x346,CODECS="avc1.64001f,mp4a.40.2",AUDIO="aac"\nsd.m3u8\n';
const media = '#EXTM3U\n#EXTINF:60,\none.m4s\n#EXTINF:61.84,\ntwo.m4s\n#EXT-X-ENDLIST\n';
const imdb = { data: { title: { primaryVideos: { edges: [{ node: { id: 'vi12345678', name: { value: 'Official Trailer' },
  contentType: { displayName: { value: 'Trailer' } }, runtime: { value: 122 }, playbackURLs: [
    { displayName: { value: '1080p' }, videoMimeType: 'MP4', url: 'https://imdb.example/hd.mp4' },
  ] } }] } } } };

describe('direkte TV-trailere', () => {
  it('tillader biografformat i HD, men aldrig SD, HEVC eller 4K', () => {
    const built = buildHlsMaster(master, 'https://apple.example/master.m3u8', 1080, true)!;
    expect(built.height).toBe(1038);
    expect(built.playlist).toContain('https://apple.example/video.m3u8');
    expect(built.playlist).toContain('https://apple.example/audio.m3u8');
    expect(built.playlist).not.toMatch(/PATHWAY-ID|sd.m3u8|4k.m3u8/);
    expect(buildHlsMaster(master.replace(/#EXT-X-MEDIA:[^\n]+\n/g, ''), 'https://apple.example/master.m3u8', 1080, true)).toBeNull();
    expect(buildHlsMaster(master.replace(/1920x1038/g, '640x346'), 'https://apple.example/master.m3u8', 1080, true)).toBeNull();
  });
  it('afviser beskyttelse, uafsluttet stream og teaser', () => {
    expect(hlsTrailerSeconds(media)).toBeCloseTo(121.84);
    expect(hlsTrailerSeconds(media.replace('#EXT-X-ENDLIST', ''))).toBeNull();
    expect(hlsTrailerSeconds('#EXTM3U\n#EXTINF:30,\nx\n#EXT-X-ENDLIST')).toBeNull();
    expect(hlsTrailerSeconds('#EXT-X-KEY:METHOD=SAMPLE-AES,URI="skd://x"\n' + media)).toBeNull();
    expect(hlsTrailerSeconds(media.replace('#EXTINF:60,', '#EXT-X-KEY:METHOD=AES-128,URI="key"\n#EXTINF:60,'))).toBeNull();
  });
  it('kontrollerer separat lyd og afviser fejlsvar uden at kaste', async () => {
    expect(await prepareDirectHls(async (url) => url.endsWith('master.m3u8') ? master : media, 'https://apple.example/master.m3u8')).toMatchObject({ height: 1038, seconds: 121.84 });
    expect(await prepareDirectHls(async (url) => url.endsWith('audio.m3u8') ? null : url.endsWith('master.m3u8') ? master : media, 'https://apple.example/master.m3u8')).toBeNull();
    expect(await prepareDirectHls(async () => { throw Error('offline'); }, 'https://apple.example/master.m3u8')).toBeNull();
    expect(await prepareDirectHls(async (url) => url.endsWith('master.m3u8') ? master + '#EXT-X-SESSION-KEY:METHOD=SAMPLE-AES,URI="skd://key"' : media, 'https://apple.example/master.m3u8')).toBeNull();
  });
  it('finder korrekt dansk titel uden TMDB-noegle og afviser forkert aar/slags', async () => {
    const data = { d: [{ id: 'tt39335022', l: 'Vores løfte', y: 2026, qid: 'movie' }] };
    const aliases = directTitleAliases(['Vores løfter']);
    expect(aliases).toContain('Vores løfte');
    expect(await findImdbTitle(async () => data, 'movie', aliases, 2026)).toBe('tt39335022');
    expect(await findImdbTitle(async () => data, 'movie', aliases, 2020)).toBeNull();
    expect(await findImdbTitle(async () => data, 'series', aliases, 2026)).toBeNull();
    expect(await findImdbTitle(async () => ({ d: [...data.d, { ...data.d[0], id: 'tt12345678' }] }), 'movie', aliases, 2026)).toBeNull();
  });
  it('bruger IMDb HD naar Apple mangler; foretager ingen YouTube-kald', async () => {
    const asked: string[] = [];
    const found = await findDirectTrailers({ getJson: async (url) => { asked.push(url); return null; }, getText: async () => null,
      postJson: async (url) => { asked.push(url); return imdb; } }, 'movie', ['Oppenheimer'], 2023, 'tt15398776');
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ provider: 'IMDb', height: 1080, contentType: 'progressive', playlist: null });
    expect(asked.join(' ')).not.toMatch(/youtube|googleapis/);
    const low = structuredClone(imdb);
    low.data.title.primaryVideos.edges[0]!.node.playbackURLs[0]!.displayName.value = '480p';
    expect(await findDirectTrailers({ getJson: async () => null, getText: async () => null, postJson: async () => low }, 'movie', ['Oppenheimer'], 2023, 'tt15398776')).toEqual([]);
  });
});

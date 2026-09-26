import { describe, expect, it } from 'vitest';
import { buildHlsMaster, buildMpd, codecsOf, pickFormats, resolveYoutubeStream } from './youtubeStream.js';
import type { PostJson, YoutubeFormat } from './youtubeStream.js';

const range = (start: number, end: number) => ({ start: String(start), end: String(end) });

function video(itag: number, height: number, mime = 'video/mp4; codecs="avc1.640028"', extra: Partial<YoutubeFormat> = {}): YoutubeFormat {
  return {
    itag,
    url: `https://rr1.googlevideo.com/videoplayback?itag=${itag}&a=1&b=2`,
    mimeType: mime,
    bitrate: height * 4000,
    width: Math.round((height * 16) / 9),
    height,
    fps: 25,
    initRange: range(0, 741),
    indexRange: range(742, 1229),
    approxDurationMs: '150000',
    ...extra,
  };
}

function audio(itag: number, mime = 'audio/mp4; codecs="mp4a.40.2"', extra: Partial<YoutubeFormat> = {}): YoutubeFormat {
  return {
    itag,
    url: `https://rr1.googlevideo.com/videoplayback?itag=${itag}&x=1`,
    mimeType: mime,
    bitrate: 130000,
    audioSampleRate: '44100',
    initRange: range(0, 631),
    indexRange: range(632, 900),
    ...extra,
  };
}

const FORMATS = [
  video(401, 2160, 'video/mp4; codecs="av01.0.12M.08"'),
  video(137, 1080),
  video(248, 1080, 'video/webm; codecs="vp9"'),
  video(136, 720),
  audio(140),
  audio(251, 'audio/webm; codecs="opus"', { bitrate: 160000 }),
];

describe('codecsOf', () => {
  it('laeser codec-navnet ud af mimeType', () => {
    expect(codecsOf('video/mp4; codecs="avc1.640028"')).toBe('avc1.640028');
    expect(codecsOf(undefined)).toBe('');
  });
});

describe('pickFormats', () => {
  it('vaelger H.264 i 1080p og AAC-lyd — ikke 4K, ikke VP9', () => {
    const picked = pickFormats(FORMATS);
    expect(picked?.video.itag).toBe(137);
    expect(picked?.audio.itag).toBe(140);
  });

  it('tager VP9 naar der ingen H.264 er', () => {
    const picked = pickFormats([video(248, 1080, 'video/webm; codecs="vp9"'), audio(251, 'audio/webm; codecs="opus"')]);
    expect(picked?.video.itag).toBe(248);
    expect(picked?.audio.itag).toBe(251);
  });

  it('springer formater uden adresse eller byte-omraader over', () => {
    const picked = pickFormats([video(137, 1080, undefined, { url: undefined }), video(136, 720), audio(140)]);
    expect(picked?.video.itag).toBe(136);
    expect(pickFormats([video(137, 1080, undefined, { indexRange: undefined }), audio(140)])).toBeNull();
  });

  it('vaelger originalsproget naar der er flere lydspor', () => {
    const dubbed = audio(140, undefined, { audioTrack: { audioIsDefault: false }, bitrate: 999999 });
    const original = audio(141, undefined, { audioTrack: { audioIsDefault: true } });
    expect(pickFormats([video(137, 1080), dubbed, original])?.audio.itag).toBe(141);
  });

  it('giver null uden lyd', () => {
    expect(pickFormats([video(137, 1080)])).toBeNull();
  });
});

describe('buildMpd', () => {
  it('bygger ét video- og ét lydspor med escapede adresser og byte-omraader', () => {
    const mpd = buildMpd(video(137, 1080), audio(140), 150);
    expect(mpd).toContain('mediaPresentationDuration="PT150.000S"');
    expect(mpd).toContain('<BaseURL>https://rr1.googlevideo.com/videoplayback?itag=137&amp;a=1&amp;b=2</BaseURL>');
    expect(mpd).toContain('<SegmentBase indexRange="742-1229"><Initialization range="0-741"/></SegmentBase>');
    expect(mpd).toContain('codecs="avc1.640028"');
    expect(mpd).toContain('height="1080"');
    expect(mpd).toContain('mimeType="audio/mp4"');
    expect(mpd.match(/<Representation /g)).toHaveLength(2);
    expect(mpd).not.toMatch(/&(?!amp;|lt;|gt;|quot;)/);
  });
});

const P = (itag: number) => `https://manifest.googlevideo.com/api/manifest/hls_playlist/expire/1/ip/2a02:1::1/itag/${itag}/playlist/index.m3u8`;
const MASTER = [
  '#EXTM3U',
  '#EXT-X-INDEPENDENT-SEGMENTS',
  `#EXT-X-MEDIA:URI="${P(233)}",TYPE=AUDIO,GROUP-ID="233",NAME="Default",DEFAULT=YES,AUTOSELECT=YES`,
  `#EXT-X-MEDIA:URI="${P(234)}",TYPE=AUDIO,GROUP-ID="234",NAME="Default",DEFAULT=YES,AUTOSELECT=YES`,
  '#EXT-X-MEDIA:URI="https://manifest.googlevideo.com/api/timedtext",TYPE=SUBTITLES,GROUP-ID="vtt",LANGUAGE="en",NAME="English"',
  '#EXT-X-STREAM-INF:BANDWIDTH=1248435,CODECS="avc1.4D401F,mp4a.40.2",RESOLUTION=1280x720,FRAME-RATE=25,AUDIO="234",SUBTITLES="vtt",CLOSED-CAPTIONS=NONE',
  P(232),
  '#EXT-X-STREAM-INF:BANDWIDTH=4688074,CODECS="avc1.640028,mp4a.40.2",RESOLUTION=1920x1080,FRAME-RATE=25,AUDIO="234",SUBTITLES="vtt",CLOSED-CAPTIONS=NONE',
  P(270),
  '#EXT-X-STREAM-INF:BANDWIDTH=1763840,CODECS="vp09.00.40.08,mp4a.40.2",RESOLUTION=1920x1080,FRAME-RATE=25,AUDIO="234",SUBTITLES="vtt",CLOSED-CAPTIONS=NONE',
  P(614),
  '#EXT-X-STREAM-INF:BANDWIDTH=9564454,CODECS="vp09.00.50.08,mp4a.40.2",RESOLUTION=2560x1440,FRAME-RATE=25,AUDIO="234",SUBTITLES="vtt",CLOSED-CAPTIONS=NONE',
  P(620),
  '',
].join('\n');

describe('buildHlsMaster', () => {
  it('beholder kun H.264 i 1080p og dens lydspor, uden undertekst-henvisning', () => {
    const built = buildHlsMaster(MASTER, 'https://manifest.googlevideo.com/api/manifest/hls_variant/x');
    expect(built?.height).toBe(1080);
    const lines = built?.playlist.split('\n') ?? [];
    expect(lines[0]).toBe('#EXTM3U');
    expect(lines.filter((l) => l.startsWith('#EXT-X-STREAM-INF'))).toHaveLength(1);
    expect(built?.playlist).toContain(P(270));
    expect(built?.playlist).toContain(`URI="${P(234)}"`);
    expect(built?.playlist).not.toContain(P(233));
    expect(built?.playlist).not.toContain('SUBTITLES');
    expect(built?.playlist).not.toContain('2560x1440');
  });

  it('giver null for noget der ikke er et HLS-manifest', () => {
    expect(buildHlsMaster('<html>', 'https://x/y')).toBeNull();
    expect(buildHlsMaster('#EXTM3U\n', 'https://x/y')).toBeNull();
  });

  it('goer relative adresser absolutte', () => {
    const text = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1,CODECS="avc1.640028",RESOLUTION=1920x1080\nv/1080.m3u8\n';
    expect(buildHlsMaster(text, 'https://h.example/a/master.m3u8')?.playlist).toContain('https://h.example/a/v/1080.m3u8');
  });
});

describe('resolveYoutubeStream', () => {
  const ok = { playabilityStatus: { status: 'OK' }, streamingData: { adaptiveFormats: FORMATS }, videoDetails: { lengthSeconds: '151' } };

  it('bygger et manifest fra den foerste klient der svarer OK', async () => {
    const calls: string[] = [];
    const post: PostJson = async (_url, headers) => {
      calls.push(headers['X-YouTube-Client-Name'] ?? '');
      return ok;
    };
    const result = await resolveYoutubeStream(post, 'dQw4w9WgXcQ');
    expect(result).toMatchObject({ kind: 'dash', seconds: 151, height: 1080, client: 'ANDROID_VR', ipFamily: '?' });
    expect(calls).toEqual(['28']);
  });

  it('giver manifestet filernes fulde laengde, ikke de afrundede sekunder', async () => {
    const withMs = {
      playabilityStatus: { status: 'OK' },
      streamingData: { adaptiveFormats: [video(137, 1080, undefined, { approxDurationMs: '213040' }), audio(140, undefined, { approxDurationMs: '213089' })] },
      videoDetails: { lengthSeconds: '213' },
    };
    const result = await resolveYoutubeStream(async () => withMs, 'dQw4w9WgXcQ');
    expect(result.kind === 'dash' && result.mpd).toContain('mediaPresentationDuration="PT213.089S"');
    expect(result).toMatchObject({ seconds: 213 });
  });

  it('proever naeste klient ved bot-tjek, og falder tilbage til webvisningen hvis alle siger nej', async () => {
    const calls: string[] = [];
    const post: PostJson = async (_url, headers) => {
      calls.push(headers['X-YouTube-Client-Name'] ?? '');
      return { playabilityStatus: { status: 'LOGIN_REQUIRED', reason: 'bot' } };
    };
    expect(await resolveYoutubeStream(post, 'dQw4w9WgXcQ')).toMatchObject({ kind: 'fallback' });
    expect(calls).toEqual(['28', '5']);
  });

  it('bruger iPhone-klientens HLS naar VR-klienten ikke kan — med 1080p-varianten', async () => {
    const post: PostJson = async (_url, headers) =>
      headers['X-YouTube-Client-Name'] === '28'
        ? { playabilityStatus: { status: 'LOGIN_REQUIRED' } }
        : { ...ok, streamingData: { ...ok.streamingData, hlsManifestUrl: 'https://manifest.googlevideo.com/api/manifest/hls_variant/ip/2a02:1::1/x' } };
    const result = await resolveYoutubeStream(post, 'dQw4w9WgXcQ', async () => MASTER);
    expect(result).toMatchObject({ kind: 'hls', height: 1080, client: 'IOS', ipFamily: 'IPv6', trace: 'VR:LOGIN_REQUIRED' });
  });

  it('tager iPhone-klientens direkte filer som sidste udvej, markeret som begraensede', async () => {
    const post: PostJson = async (_url, headers) =>
      headers['X-YouTube-Client-Name'] === '28' ? { playabilityStatus: { status: 'LOGIN_REQUIRED' } } : ok;
    const result = await resolveYoutubeStream(post, 'dQw4w9WgXcQ', async () => null);
    expect(result).toMatchObject({ kind: 'dash', client: 'IOS', limited: true, trace: 'VR:LOGIN_REQUIRED IOS:ingen-hls' });
    // 720p, ikke 1080p: graensen er maaske en datamaengde (v334).
    expect(result).toMatchObject({ height: 720 });
  });

  it('fortaeller om adressen er bundet til IPv4 eller IPv6 — aldrig adressen selv', async () => {
    const at = (ip: string) => ({
      playabilityStatus: { status: 'OK' },
      streamingData: { adaptiveFormats: [video(137, 1080, undefined, { url: `https://rr1.googlevideo.com/videoplayback?ip=${ip}&itag=137` }), audio(140)] },
    });
    expect(await resolveYoutubeStream(async () => at('2a02%3A1234%3A%3A1'), 'dQw4w9WgXcQ')).toMatchObject({ ipFamily: 'IPv6' });
    expect(await resolveYoutubeStream(async () => at('80.62.1.2'), 'dQw4w9WgXcQ')).toMatchObject({ ipFamily: 'IPv4' });
  });

  it('siger hvorfor, naar den falder tilbage', async () => {
    const post: PostJson = async () => ({ playabilityStatus: { status: 'LOGIN_REQUIRED' } });
    expect(await resolveYoutubeStream(post, 'dQw4w9WgXcQ')).toEqual({ kind: 'fallback', why: 'VR:LOGIN_REQUIRED/IOS:LOGIN_REQUIRED' });
  });

  it('siger "kan ikke ses" naar alle klienter siger at videoen er spaerret', async () => {
    const post: PostJson = async () => ({ playabilityStatus: { status: 'UNPLAYABLE', reason: 'ikke i dit land' } });
    expect(await resolveYoutubeStream(post, 'dQw4w9WgXcQ')).toEqual({ kind: 'unavailable' });
  });

  it('falder tilbage ved netfejl og ved svar uden brugbare formater', async () => {
    expect(await resolveYoutubeStream(async () => null, 'dQw4w9WgXcQ')).toMatchObject({ kind: 'fallback' });
    expect(
      await resolveYoutubeStream(async () => {
        throw new Error('net');
      }, 'dQw4w9WgXcQ'),
    ).toMatchObject({ kind: 'fallback' });
    const empty = { playabilityStatus: { status: 'OK' }, streamingData: { adaptiveFormats: [] } };
    expect(await resolveYoutubeStream(async () => empty, 'dQw4w9WgXcQ')).toMatchObject({ kind: 'fallback' });
  });

  it('spoerger ikke YouTube om et id der ikke er et YouTube-id', async () => {
    let asked = false;
    const post: PostJson = async () => {
      asked = true;
      return ok;
    };
    expect(await resolveYoutubeStream(post, '"><script>')).toEqual({ kind: 'unavailable' });
    expect(asked).toBe(false);
  });
});

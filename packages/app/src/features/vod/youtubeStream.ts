/**
 * Traileren som rigtig video i appens egen afspiller — saadan Googles
 * tv-butik goer, i stedet for YouTubes afspiller i en webvisning.
 *
 * Brugeren sammenlignede med Googles butik: den starter med det samme og i
 * fuld HD, mens webvisningen paa en tv-boks er langsom og begynder i lav
 * kvalitet. Butikken henter videofilen fra YouTube og spiller den i en
 * native afspiller. Det goer vi ogsaa nu (brugerens valg, med vilje: det er
 * uofficielt og kan holde op med at virke naar YouTube aendrer noget).
 *
 * Vejen er den SmartTube og NewPipe bruger: YouTubes egne app-klienter
 * (VR-brillernes, iPhone-appens) spoerges gennem /youtubei/v1/player og
 * svarer med direkte adresser til video og lyd hver for sig. Maalt fra
 * GitHubs maskine (scripts/maal/youtube-stroem.mjs, 25. sep. 2026):
 * ANDROID_VR og IOS giver 1080p/4K, adresserne svarer 206 paa faa ms, og
 * de er ligeglade med User-Agent (vigtigt: afspilleren sender sin egen).
 *
 * Video og lyd er separate filer; ExoPlayer faar dem samlet i et lille
 * DASH-manifest vi selv skriver (buildMpd). Kun ÉN videokvalitet kommer
 * med — den bedste op til 1080p — saa afspilleren starter i HD med det
 * samme i stedet for at begynde lavt og kravle op.
 *
 * Kan det ikke lade sig goere (bot-tjek, netfejl, intet brugbart format),
 * svares `fallback`, og traileren spilles som foer i webvisningen. Siger
 * YouTube at videoen ikke kan ses (spaerret i Danmark, fjernet), svares
 * `unavailable`, og naeste kandidat proeves — webvisningen ville fejle
 * paa samme maade.
 */

/** POST af JSON; svarer null ved netfejl eller et svar der ikke er JSON. */
export type PostJson = (url: string, headers: Record<string, string>, body: string) => Promise<unknown>;

interface ClientSpec {
  id: number;
  context: Record<string, string | number>;
  userAgent: string;
}

/**
 * Raekkefoelgen er den maalte: VR-klienten giver direkte adresser uden
 * ekstra noegler; iPhone-klienten det samme plus en HLS-adresse.
 */
const CLIENTS: ClientSpec[] = [
  {
    id: 28,
    context: {
      clientName: 'ANDROID_VR',
      clientVersion: '1.62.27',
      deviceMake: 'Oculus',
      deviceModel: 'Quest 3',
      androidSdkVersion: 32,
      osName: 'Android',
      osVersion: '12L',
    },
    userAgent:
      'com.google.android.apps.youtube.vr.oculus/1.62.27 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip',
  },
  {
    id: 5,
    context: {
      clientName: 'IOS',
      clientVersion: '20.10.4',
      deviceMake: 'Apple',
      deviceModel: 'iPhone16,2',
      osName: 'iPhone',
      osVersion: '18.3.2.22D82',
    },
    userAgent: 'com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)',
  },
];

const PLAYER_URL = 'https://www.youtube.com/youtubei/v1/player?prettyPrint=false';

/** Hoejeste kvalitet der vaelges. Fuld HD er det Googles butik viser; 4K er spild paa en trailer. */
export const MAX_TRAILER_HEIGHT = 1080;

export interface ByteRange {
  start: string;
  end: string;
}

export interface YoutubeFormat {
  itag?: number;
  url?: string;
  mimeType?: string;
  bitrate?: number;
  width?: number;
  height?: number;
  fps?: number;
  initRange?: ByteRange;
  indexRange?: ByteRange;
  approxDurationMs?: string;
  audioSampleRate?: string;
  audioTrack?: { audioIsDefault?: boolean };
}

export type YoutubeStream =
  /** Et DASH-manifest (tekst) appen skriver til en fil og spiller. */
  | { kind: 'dash'; mpd: string; seconds: number | null; height: number }
  /** YouTube siger nej til netop den video: proev den naeste. */
  | { kind: 'unavailable' }
  /** Det lykkedes ikke her: spil den i webvisningen som foer. */
  | { kind: 'fallback' };

/** Statusser der betyder at videoen ikke kan ses — ikke at vi blev afvist som bot. */
const UNAVAILABLE = new Set(['UNPLAYABLE', 'ERROR']);

/**
 * Spoerger klienterne efter tur, og bygger et manifest af den foerste der
 * svarer OK med brugbare formater.
 */
export async function resolveYoutubeStream(post: PostJson, videoId: string): Promise<YoutubeStream> {
  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) return { kind: 'unavailable' };
  let unavailable = 0;
  let answered = 0;
  for (const client of CLIENTS) {
    let response: unknown;
    try {
      response = await post(PLAYER_URL, playerHeaders(client), playerBody(client, videoId));
    } catch {
      response = null;
    }
    if (response === null || typeof response !== 'object') continue;
    answered += 1;
    const data = response as {
      playabilityStatus?: { status?: string };
      streamingData?: { adaptiveFormats?: YoutubeFormat[] };
      videoDetails?: { lengthSeconds?: string };
    };
    const status = data.playabilityStatus?.status;
    if (status !== 'OK') {
      if (status !== undefined && UNAVAILABLE.has(status)) unavailable += 1;
      continue;
    }
    const picked = pickFormats(data.streamingData?.adaptiveFormats ?? []);
    if (picked === null) continue;
    const seconds = lengthOf(data.videoDetails?.lengthSeconds, picked.video.approxDurationMs);
    return { kind: 'dash', mpd: buildMpd(picked.video, picked.audio, seconds), seconds, height: picked.video.height ?? 0 };
  }
  // Kun naar ALLE der svarede sagde "kan ikke ses" er det videoen der er
  // noget galt med; et enkelt nej kan vaere klientens eget.
  return answered > 0 && unavailable === answered ? { kind: 'unavailable' } : { kind: 'fallback' };
}

function playerHeaders(client: ClientSpec): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'User-Agent': client.userAgent,
    'X-YouTube-Client-Name': String(client.id),
    'X-YouTube-Client-Version': String(client.context.clientVersion),
    Origin: 'https://www.youtube.com',
  };
}

function playerBody(client: ClientSpec, videoId: string): string {
  return JSON.stringify({
    context: { client: { ...client.context, hl: 'da', gl: 'DK' } },
    videoId,
    contentCheckOk: true,
    racyCheckOk: true,
  });
}

function lengthOf(lengthSeconds: string | undefined, approxMs: string | undefined): number | null {
  const s = Number(lengthSeconds);
  if (Number.isFinite(s) && s > 0) return s;
  const ms = Number(approxMs);
  return Number.isFinite(ms) && ms > 0 ? ms / 1000 : null;
}

/** Codecs-delen af en mimeType: `video/mp4; codecs="avc1.640028"` -> `avc1.640028`. */
export function codecsOf(mimeType: string | undefined): string {
  return /codecs="([^"]+)"/.exec(mimeType ?? '')?.[1] ?? '';
}

function containerOf(mimeType: string | undefined): string {
  return (mimeType ?? '').split(';')[0]?.trim() ?? '';
}

/** Formatet kan laegges i manifestet: har adresse og byte-omraader. */
function usable(format: YoutubeFormat): boolean {
  return (
    typeof format.url === 'string' &&
    format.url.startsWith('https://') &&
    format.initRange !== undefined &&
    format.indexRange !== undefined
  );
}

/**
 * Video: H.264 (mp4) foerst — alle tv-bokse afkoder det i hardware — den
 * hoejeste op til MAX_TRAILER_HEIGHT; VP9 kun hvis der ingen H.264 er.
 * Lyd: AAC (mp4) foerst, originalsporet hvis der er flere sprog.
 */
export function pickFormats(
  formats: YoutubeFormat[],
  maxHeight = MAX_TRAILER_HEIGHT,
): { video: YoutubeFormat; audio: YoutubeFormat } | null {
  const ok = formats.filter(usable);
  const videos = ok.filter((f) => (f.height ?? 0) > 0 && (f.height ?? 0) <= maxHeight && (f.mimeType ?? '').startsWith('video/'));
  const byQuality = (a: YoutubeFormat, b: YoutubeFormat): number =>
    (b.height ?? 0) - (a.height ?? 0) || (b.fps ?? 0) - (a.fps ?? 0) || (b.bitrate ?? 0) - (a.bitrate ?? 0);
  const h264 = videos.filter((f) => containerOf(f.mimeType) === 'video/mp4' && codecsOf(f.mimeType).startsWith('avc1')).sort(byQuality);
  const vp9 = videos.filter((f) => containerOf(f.mimeType) === 'video/webm' && codecsOf(f.mimeType).startsWith('vp')).sort(byQuality);
  const video = h264[0] ?? vp9[0];
  if (video === undefined) return null;

  const audios = ok.filter((f) => (f.mimeType ?? '').startsWith('audio/'));
  const original = audios.filter((f) => f.audioTrack === undefined || f.audioTrack.audioIsDefault === true);
  const pool = original.length > 0 ? original : audios;
  const byBitrate = (a: YoutubeFormat, b: YoutubeFormat): number => (b.bitrate ?? 0) - (a.bitrate ?? 0);
  const aac = pool.filter((f) => containerOf(f.mimeType) === 'audio/mp4' && codecsOf(f.mimeType).startsWith('mp4a')).sort(byBitrate);
  const opus = pool.filter((f) => containerOf(f.mimeType) === 'audio/webm').sort(byBitrate);
  const audio = aac.find((f) => f.itag === 140) ?? aac[0] ?? opus[0];
  if (audio === undefined) return null;
  return { video, audio };
}

function xml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function representation(format: YoutubeFormat, kind: 'video' | 'audio'): string {
  const attrs = [
    `id="${format.itag ?? kind}"`,
    `codecs="${xml(codecsOf(format.mimeType))}"`,
    `bandwidth="${Math.max(1, Math.round(format.bitrate ?? 1))}"`,
  ];
  if (kind === 'video') {
    if (format.width !== undefined) attrs.push(`width="${format.width}"`);
    if (format.height !== undefined) attrs.push(`height="${format.height}"`);
    if (format.fps !== undefined) attrs.push(`frameRate="${format.fps}"`);
  } else if (format.audioSampleRate !== undefined) {
    attrs.push(`audioSamplingRate="${xml(format.audioSampleRate)}"`);
  }
  const init = format.initRange as ByteRange;
  const index = format.indexRange as ByteRange;
  return (
    `<Representation ${attrs.join(' ')}>` +
    `<BaseURL>${xml(format.url as string)}</BaseURL>` +
    `<SegmentBase indexRange="${xml(index.start)}-${xml(index.end)}"><Initialization range="${xml(init.start)}-${xml(init.end)}"/></SegmentBase>` +
    `</Representation>`
  );
}

/**
 * Et statisk DASH-manifest med én video og én lyd. Adresserne XML-escapes
 * (de er fulde af &), og intet andet end YouTubes egne felter bygges ind.
 */
export function buildMpd(video: YoutubeFormat, audio: YoutubeFormat, seconds: number | null): string {
  const duration = seconds !== null && seconds > 0 ? ` mediaPresentationDuration="PT${seconds.toFixed(3)}S"` : '';
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static" minBufferTime="PT1.5S"${duration} profiles="urn:mpeg:dash:profile:isoff-on-demand:2011">` +
    `<Period>` +
    `<AdaptationSet contentType="video" mimeType="${xml(containerOf(video.mimeType))}" subsegmentAlignment="true">${representation(video, 'video')}</AdaptationSet>` +
    `<AdaptationSet contentType="audio" mimeType="${xml(containerOf(audio.mimeType))}" subsegmentAlignment="true">${representation(audio, 'audio')}</AdaptationSet>` +
    `</Period></MPD>`
  );
}

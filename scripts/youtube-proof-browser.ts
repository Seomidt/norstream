/** Koeres i boksens rigtige WebView; native bro holder samme net/session. */
import { BotGuardClient } from 'bgutils-js/botguard';
import { WebPoMinter } from 'bgutils-js/webpo';
import { buildURL, getHeaders, parseLooseJSON } from 'bgutils-js/utils';
import { Innertube, Platform, ClientType } from 'youtubei.js/web';
import { pickFormats } from '../packages/app/src/features/vod/youtubeStream.js';

const pending = new Map<number, { resolve: (r: Response) => void; reject: (e: Error) => void }>();
let serial = 0;
const host = window as unknown as {
  ReactNativeWebView: { postMessage: (s: string) => void };
  NorStreamProofReply: (value: { serial: number; status?: number; headers?: Record<string, string>; body?: string; error?: boolean }) => void;
  NorStreamProofStart: (id: string) => void;
  yt: { config_: Record<string, unknown> };
};
function post(message: unknown) { host.ReactNativeWebView.postMessage(JSON.stringify(message)); }
host.NorStreamProofReply = (value) => {
  const task = pending.get(value.serial);
  if (!task) return;
  pending.delete(value.serial);
  if (value.error) task.reject(new Error('Netvaerk afvist'));
  else task.resolve(new Response(value.body || '', { status: value.status, headers: value.headers }));
};
async function network(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const request = new Request(input, init);
  const body = request.method === 'GET' ? undefined : await request.text();
  const key = ++serial;
  const headers: Record<string, string> = {};
  request.headers.forEach((value, name) => { headers[name] = value; });
  headers['user-agent'] = navigator.userAgent;
  return new Promise((resolve, reject) => {
    pending.set(key, { resolve, reject });
    post({ type: 'request', serial: key, url: request.url, method: request.method, headers, body });
  });
}
let running = false;
let phase = 'session';
host.NorStreamProofStart = (id) => {
  if (running || !/^[A-Za-z0-9_-]{11}$/.test(id)) return;
  running = true;
  void resolve(id).catch(() => post({ type: 'failed', phase }));
};
async function resolve(id: string) {
  let bg: BotGuardClient | undefined;
  try {
    const home = await network('https://www.youtube.com/', { headers: { 'accept-language': 'en-US,en;q=0.7' } });
    if (!home.ok) throw new Error('Homepage');
    const html = await home.text();
    phase = 'challenge';
    const config = JSON.parse(html.match(/ytcfg\.set\(({.+?})\);/s)?.[1] ?? '{}');
    const initial = parseLooseJSON(html.match(/window\.ytAtN\(\s*({[\s\S]*?})\s*\)/)?.[1] ?? '{}') as { R?: { bgChallenge?: { interpreterUrl: { privateDoNotAccessOrElseTrustedResourceUrlWrappedValue: string }; program: string; globalName: string } } };
    const challenge = initial.R?.bgChallenge;
    if (!challenge || typeof config.VISITOR_DATA !== 'string') throw new Error('Challenge');
    host.yt = { config_: config };
    phase = 'interpreter';
    const interpreter = new URL(challenge.interpreterUrl.privateDoNotAccessOrElseTrustedResourceUrlWrappedValue, 'https://www.youtube.com/');
    // Kun YouTubes leverede BotGuard-fortolker fra Googles kendte sti.
    if (interpreter.protocol !== 'https:' || !['www.google.com', 'www.youtube.com'].includes(interpreter.hostname) || !interpreter.pathname.startsWith('/js/')) throw new Error('Interpreter');
    const script = await network(interpreter);
    if (!script.ok) throw new Error('Interpreter');
    new Function(await script.text())();
    phase = 'snapshot';
    bg = await BotGuardClient.create({ program: challenge.program, globalName: challenge.globalName, globalObject: globalThis });
    const output: import('bgutils-js/shared-types').WebPoSignalOutput = [];
    const snapshot = await bg.snapshot({ webPoSignalOutput: output });
    phase = 'integrity';
    const integrity = await network(buildURL('GenerateIT', true), { method: 'POST', headers: getHeaders(), body: JSON.stringify(['O43z0dpjhgX20SCx4KAo', snapshot]) });
    if (!integrity.ok) throw new Error('Integrity');
    const [integrityToken, estimatedTtlSecs, mintRefreshThreshold, websafeFallbackToken] = await integrity.json();
    const minter = await WebPoMinter.create({ integrityToken, estimatedTtlSecs, mintRefreshThreshold, websafeFallbackToken }, output);
    post({ type: 'attested' });
    // Player-bevis er sessionsbundet; GVS-bevis bindes til videoen.
    phase = 'player';
    const sessionToken = await minter.mintAsWebsafeString(config.VISITOR_DATA);
    const videoToken = await minter.mintAsWebsafeString(id);
    Platform.shim.eval = async (data) => new Function(data.output)();
    const tube = await Innertube.create({ visitor_data: config.VISITOR_DATA, po_token: sessionToken, user_agent: navigator.userAgent, client_type: ClientType.MWEB, generate_session_locally: true, retrieve_innertube_config: false, fetch: network });
    const info = await tube.getBasicInfo(id, { client: 'MWEB', po_token: sessionToken });
    phase = 'formats';
    const originals = info.streaming_data?.adaptive_formats ?? [];
    const formats = originals.map((f) => ({ itag: f.itag, url: 'https://placeholder.invalid', mimeType: f.mime_type, bitrate: f.bitrate, width: f.width, height: f.height, fps: f.fps, initRange: f.init_range && { start: String(f.init_range.start), end: String(f.init_range.end) }, indexRange: f.index_range && { start: String(f.index_range.start), end: String(f.index_range.end) }, approxDurationMs: String(f.approx_duration_ms), audioSampleRate: String(f.audio_sample_rate), audioTrack: f.audio_track && { audioIsDefault: f.audio_track.audio_is_default } }));
    const picked = pickFormats(formats);
    if (!picked) throw new Error('Formats');
    phase = 'decipher';
    const media = await Promise.all([picked.video, picked.audio].map(async (format) => {
      const original = originals.find((f) => f.itag === format.itag)!;
      const url = new URL(await original.decipher(tube.session.player));
      url.searchParams.set('pot', videoToken);
      return { ...format, url: url.toString(), contentLength: original.content_length };
    }));
    const seconds = Math.max(Number(info.basic_info.duration) || 0, ...media.map((f) => Number(f.approxDurationMs) / 1000));
    post({ type: 'resolved', video: media[0], audio: media[1], seconds, userAgent: navigator.userAgent });
  } finally {
    await bg?.shutdown().catch(() => {});
  }
}
post({ type: 'ready' });

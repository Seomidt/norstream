import { buildTimeshiftUrl } from '@norstream/core';
import type { Programme, TimeshiftDialect, XtreamCredentials } from '@norstream/core';
import { safe } from '../../diagnostics/log.js';
import { LIVE_EDGE_LAG_MS } from './archiveContinuation.js';

/**
 * "Test start forfra" (v355): kan panelet levere arkivet som en stroem der
 * VOKSER, mens udsendelsen stadig sendes?
 *
 * Brugeren: "Kan vi ikke goere saa den buffer loebende, det maa da give et
 * bedre flow." Appen kan ikke selv: panelet tillader én forbindelse, saa den
 * kan ikke baade optage live og hente det der blev sendt foer. Den loebende
 * buffer kan kun komme fra panelet — som TV 2 Plays egen server, hvor
 * "start forfra" er et spring tilbage i den samme strom. Xtream-paneler
 * leverer arkivet som HLS-spilleliste; vokser den (ingen ENDLIST, flere
 * stykker 30 s senere), kan afspilleren foelge den som live med spoling.
 * Goer den ikke, er den stykkevise vej (archiveContinuation) det bedste.
 *
 * Rapporten rummer aldrig adresser (de har panelets kodeord).
 */
export interface ProbeResponse {
  status: number;
  /** Svarets hoveder med smaa bogstaver i noeglen. */
  headers: Record<string, string>;
  /** Kroppen som tekst; null naar der kun blev bedt om hovederne. */
  text: string | null;
}

/** `headersOnly`: kun status og hoveder (HEAD eller afbrudt GET); kroppen kan vaere en voksende stroem. */
export type ProbeFetch = (url: string, headersOnly: boolean) => Promise<ProbeResponse>;

export interface PlaylistFacts {
  /** Master-spilleliste (varianter) i stedet for stykker. */
  variants: string[];
  segments: number;
  seconds: number;
  ended: boolean;
  type: string | null;
  mediaSequence: number | null;
}

/** Laeser det der betyder noget i en HLS-spilleliste. */
export function readPlaylist(text: string): PlaylistFacts {
  const facts: PlaylistFacts = { variants: [], segments: 0, seconds: 0, ended: false, type: null, mediaSequence: null };
  const lines = text.split(/\r?\n/).map((line) => line.trim());
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    if (line.startsWith('#EXT-X-STREAM-INF')) {
      const next = lines[i + 1] ?? '';
      if (next.length > 0 && !next.startsWith('#')) facts.variants.push(next);
    } else if (line.startsWith('#EXTINF:')) {
      const seconds = Number.parseFloat(line.slice('#EXTINF:'.length));
      if (Number.isFinite(seconds)) facts.seconds += seconds;
      facts.segments += 1;
    } else if (line.startsWith('#EXT-X-ENDLIST')) {
      facts.ended = true;
    } else if (line.startsWith('#EXT-X-PLAYLIST-TYPE:')) {
      facts.type = line.slice('#EXT-X-PLAYLIST-TYPE:'.length).trim();
    } else if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) {
      const sequence = Number.parseInt(line.slice('#EXT-X-MEDIA-SEQUENCE:'.length), 10);
      if (Number.isFinite(sequence)) facts.mediaSequence = sequence;
    }
  }
  return facts;
}

/** En relativ variant-adresse loest mod spillelistens egen. */
export function resolveVariant(base: string, variant: string): string {
  if (/^https?:\/\//i.test(variant)) return variant;
  if (variant.startsWith('/')) {
    const origin = /^(https?:\/\/[^/]+)/i.exec(base)?.[1] ?? '';
    return origin + variant;
  }
  return base.replace(/[^/]*$/, '') + variant;
}

export interface ProbeOptions {
  now?: number;
  /** Hvor laenge der ventes mellem de to laesninger af spillelisten. */
  waitMs?: number;
  sleep?: (ms: number) => Promise<void>;
  onProgress?: (text: string) => void;
}

function clock(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function describe(facts: PlaylistFacts): string {
  return `${facts.segments} stykker, ${Math.round(facts.seconds)} s, ENDLIST: ${facts.ended ? 'ja' : 'nej'}${facts.type !== null ? `, type ${facts.type}` : ''}`;
}

async function playlist(fetchProbe: ProbeFetch, url: string): Promise<{ status: number; facts: PlaylistFacts | null; error: string | null }> {
  try {
    let response = await fetchProbe(url, false);
    if (response.status !== 200 || response.text === null) return { status: response.status, facts: null, error: null };
    let facts = readPlaylist(response.text);
    const variant = facts.variants[0];
    if (variant !== undefined && facts.segments === 0) {
      response = await fetchProbe(resolveVariant(url, variant), false);
      if (response.status !== 200 || response.text === null) return { status: response.status, facts: null, error: null };
      facts = readPlaylist(response.text);
    }
    return { status: response.status, facts, error: null };
  } catch (cause) {
    return { status: 0, facts: null, error: safe(cause instanceof Error ? cause.message : String(cause)) };
  }
}

/**
 * Maaler panelets arkiv for en udsendelse der stadig sendes, og svarer med
 * en rapport man kan tage et skaermbillede af. Tre maalinger:
 *
 *  A. HLS fra udsendelsens start til dens SLUT (altsaa ud i fremtiden) — laest
 *     to gange med `waitMs` imellem. Vokser den, kan afspilleren foelge den.
 *  B. HLS kun for det der findes nu (til nu − 90 s) — det appen beder om i dag.
 *  C. .ts fra start til slut — kun hovederne: en Content-Length er en faerdig
 *     fil; ingen (chunked) kan vaere en stroem der vokser.
 */
export async function probeTimeshift(
  fetchProbe: ProbeFetch,
  creds: XtreamCredentials,
  streamId: string,
  programme: Programme,
  dialect: TimeshiftDialect,
  offsetMinutes: number,
  options: ProbeOptions = {},
): Promise<string> {
  const now = options.now ?? Date.now();
  const waitMs = options.waitMs ?? 30_000;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const lines: string[] = [];
  const say = (text: string): void => {
    lines.push(text);
    options.onProgress?.(lines.join('\n'));
  };
  const startMs = programme.start.getTime();
  const endMs = programme.stop.getTime();
  const stillOn = endMs > now;
  say(`Udsendelse ${clock(startMs)}–${clock(endMs)}, nu ${clock(now)}${stillOn ? '' : ' (slut — testen siger mest om igangværende udsendelser)'}. Dialekt ${dialect}, offset ${offsetMinutes} min.`);

  const toEndMinutes = Math.max(1, Math.ceil((endMs - startMs) / 60_000));
  const existingMinutes = Math.max(1, Math.ceil((Math.min(endMs, now - LIVE_EDGE_LAG_MS) - startMs) / 60_000));

  // A. HLS til udsendelsens slut, to gange.
  const urlA = buildTimeshiftUrl(creds, streamId, programme.start, toEndMinutes, dialect, offsetMinutes, 'm3u8');
  const first = await playlist(fetchProbe, urlA);
  let grows: boolean | null = null;
  if (first.facts === null) {
    say(`A. HLS til slut (${toEndMinutes} min): ${first.error !== null ? `fejl: ${first.error}` : `svar ${first.status}, ingen spilleliste`}.`);
  } else {
    say(`A. HLS til slut (${toEndMinutes} min): svar 200, ${describe(first.facts)}.`);
    if (stillOn && !first.facts.ended) {
      say(`   venter ${Math.round(waitMs / 1000)} s og læser igen …`);
      await sleep(waitMs);
      const second = await playlist(fetchProbe, urlA);
      if (second.facts === null) {
        say(`   anden læsning: ${second.error !== null ? `fejl: ${second.error}` : `svar ${second.status}`}.`);
      } else {
        grows = second.facts.seconds > first.facts.seconds + 1;
        say(`   anden læsning: ${describe(second.facts)} → vokser: ${grows ? `JA (+${Math.round(second.facts.seconds - first.facts.seconds)} s)` : 'nej'}.`);
      }
    } else if (stillOn) {
      grows = false;
      say('   spillelisten er lukket (ENDLIST) selv om udsendelsen sendes: panelet giver kun det der findes nu.');
    }
  }

  // B. HLS kun for det der findes (som appen beder om i dag).
  const urlB = buildTimeshiftUrl(creds, streamId, programme.start, existingMinutes, dialect, offsetMinutes, 'm3u8');
  const existing = await playlist(fetchProbe, urlB);
  say(
    existing.facts === null
      ? `B. HLS kun det der findes (${existingMinutes} min): ${existing.error !== null ? `fejl: ${existing.error}` : `svar ${existing.status}, ingen spilleliste`}.`
      : `B. HLS kun det der findes (${existingMinutes} min): svar 200, ${describe(existing.facts)}.`,
  );

  // C. .ts til slut: kun hovederne.
  const urlC = buildTimeshiftUrl(creds, streamId, programme.start, toEndMinutes, dialect, offsetMinutes, 'ts');
  try {
    const head = await fetchProbe(urlC, true);
    const length = head.headers['content-length'];
    const encoding = head.headers['transfer-encoding'];
    say(
      `C. .ts til slut: svar ${head.status}, ${length !== undefined ? `Content-Length ${Math.round(Number(length) / 1048576)} MB (færdig fil)` : `ingen Content-Length${encoding !== undefined ? ` (${encoding})` : ''} — en strøm, der kan vokse`}.`,
    );
  } catch (cause) {
    say(`C. .ts til slut: ${safe(cause instanceof Error ? cause.message : String(cause))}.`);
  }

  if (grows === true) say('Konklusion: panelet leverer et arkiv der vokser. En løbende buffer (afspilleren følger spillelisten som live, med spoling bagud) er mulig.');
  else if (grows === false) say('Konklusion: panelet giver kun det der findes, når der bedes om det. Stykke for stykke (som nu) er det bedste, panelet tillader.');
  else say('Konklusion: kunne ikke afgøres (se linjerne ovenfor). Prøv igen på en udsendelse der sendes nu, og med afspilleren lukket.');
  return lines.join('\n');
}

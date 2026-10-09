import { streamSource } from '../../net/doh.js';
import type { ProbeFetch } from './timeshiftProbe.js';

/** Hvor laenge der ventes paa panelet per kald. */
const TIMEOUT_MS = 20_000;

function headerMap(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key.toLowerCase()] = value;
  });
  return out;
}

/**
 * Appens hentning til "Test start forfra" (v355): den rigtige `fetch` med
 * DNS-noedudgangens vaert (streamSource), ikke appens API-indpakning, for
 * her skal svarets hoveder laeses.
 *
 * `headersOnly` (.ts-maalingen): React Natives fetch svarer foerst naar hele
 * kroppen er hentet, og en arkiv-stroem kan vaere stor eller uendelig. Derfor
 * HEAD foerst; svarer panelet ikke paa HEAD, en GET med `Range: bytes=0-1023`.
 * Ignorerer panelet ogsaa Range og bliver ved med at stroemme, loeber tiden
 * ud — og det er i sig selv et svar: en stroem uden ende.
 */
export const probeFetch: ProbeFetch = async (url, headersOnly) => {
  const source = streamSource(url);
  const target = typeof source === 'string' ? source : source.uri;
  const base: Record<string, string> = typeof source === 'string' ? {} : { ...source.headers };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    if (headersOnly) {
      try {
        const head = await fetch(target, { method: 'HEAD', headers: base, signal: controller.signal });
        if (head.status < 400) return { status: head.status, headers: headerMap(head.headers), text: null };
      } catch {
        // HEAD afvist eller ikke understoettet: GET med Range nedenfor.
      }
      const ranged = await fetch(target, { headers: { ...base, Range: 'bytes=0-1023' }, signal: controller.signal });
      return { status: ranged.status, headers: headerMap(ranged.headers), text: null };
    }
    const response = await fetch(target, { headers: base, signal: controller.signal });
    return { status: response.status, headers: headerMap(response.headers), text: await response.text() };
  } catch (cause) {
    const text = cause instanceof Error ? cause.message : String(cause);
    if (/abort/i.test(text)) {
      throw new Error(`svaret blev ved med at strømme i ${Math.round(TIMEOUT_MS / 1000)} s uden at slutte (en strøm uden ende, eller panelet er langsomt)`);
    }
    throw cause;
  } finally {
    clearTimeout(timer);
  }
};

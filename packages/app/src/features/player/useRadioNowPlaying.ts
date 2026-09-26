import { useEffect, useState } from 'react';
import { fetch as streamingFetch } from 'expo/fetch';
import type { RadioNowPlaying } from './RadioView.js';
import { IcyScanner, coverFromItunes, extractStreamTitle, itunesSearchUrl, parseNowPlaying } from './icy.js';

const USER_AGENT = 'NorStream/1.0 (Android; +https://github.com/Seomidt/norstream)';
/** Hvor tit titlen laeses igen. En sang er sjaeldent under tre minutter; 20 sekunder foeles som "med det samme". */
const POLL_MS = 20_000;
/** Hoejst saa lang tid paa én laesning: en station der aldrig sender titel skal ikke holde en forbindelse. */
const READ_TIMEOUT_MS = 12_000;

const covers = new Map<string, string | null>();

/**
 * Laeser stationens "StreamTitle" af en lille sidestroem: aabner streamen
 * med Icy-MetaData, laeser frem til den foerste metadatablok, lukker igen.
 * Det koster omkring én metaint (typisk 16 kB) per opslag.
 */
async function readTitle(url: string, signal: AbortSignal): Promise<string | null> {
  const response = await streamingFetch(url, { headers: { 'Icy-MetaData': '1', 'User-Agent': USER_AGENT }, signal });
  const metaint = Number.parseInt(response.headers.get('icy-metaint') ?? '', 10);
  const body = response.body;
  if (!Number.isFinite(metaint) || metaint <= 0 || metaint > 1_000_000 || body === null) {
    await body?.cancel().catch(() => undefined);
    return null;
  }
  const reader = body.getReader();
  const scanner = new IcyScanner(metaint);
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done || value === undefined) return null;
      const block = scanner.push(value);
      if (block !== null) return extractStreamTitle(block);
      if (scanner.exhausted) return null;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

async function coverFor(artist: string, track: string, signal: AbortSignal): Promise<string | null> {
  const key = `${artist.toLowerCase()}|${track.toLowerCase()}`;
  const known = covers.get(key);
  if (known !== undefined) return known;
  let found: string | null = null;
  try {
    const response = await fetch(itunesSearchUrl({ artist, track }), { headers: { 'User-Agent': USER_AGENT }, signal });
    if (response.ok) found = coverFromItunes(await response.text());
  } catch {
    // Intet cover, saa staar logoet.
  }
  if (covers.size > 200) covers.clear();
  covers.set(key, found);
  return found;
}

/**
 * Sang og cover for en internetradio, som i NorRadio: "Kunstner - Titel"
 * fra streamen og coveret fra iTunes. Null naar stationen ikke sender
 * titel, eller naar `url` er null (panelets kanaler, som ikke er Icecast).
 */
export function useRadioNowPlaying(url: string | null, stationName: string, active: boolean): RadioNowPlaying | null {
  const [playing, setPlaying] = useState<RadioNowPlaying | null>(null);

  useEffect(() => {
    setPlaying(null);
    if (url === null || !active) return;
    let cancelled = false;
    let lastTitle: string | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const controller = new AbortController();

    const poll = async (): Promise<void> => {
      const timeout = setTimeout(() => controller.abort(), READ_TIMEOUT_MS);
      let title: string | null = null;
      try {
        title = await readTitle(url, controller.signal);
      } catch {
        // Netvaerk, eller afbrudt. Naeste runde proever igen.
      } finally {
        clearTimeout(timeout);
      }
      if (cancelled) return;
      if (title !== null && title !== lastTitle) {
        lastTitle = title;
        const parsed = parseNowPlaying(title, stationName);
        if (parsed === null) setPlaying(null);
        else {
          setPlaying({ artist: parsed.artist, track: parsed.track, coverUrl: null });
          const cover = await coverFor(parsed.artist, parsed.track, controller.signal);
          if (!cancelled) setPlaying((current) => (current !== null && current.track === parsed.track ? { ...current, coverUrl: cover } : current));
        }
      }
      if (!cancelled) timer = setTimeout(() => void poll(), POLL_MS);
    };
    void poll();

    return () => {
      cancelled = true;
      if (timer !== null) clearTimeout(timer);
      controller.abort();
    };
  }, [url, stationName, active]);

  return playing;
}

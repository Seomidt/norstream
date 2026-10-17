/**
 * Det der spilles lige nu, laest ud af en Icecast-stream. Ren beregning;
 * hentningen ligger i useRadioNowPlaying.
 *
 * Icecast sender med "Icy-MetaData: 1" en tekstblok ind i lyden for hver
 * `icy-metaint` byte: én laengdebyte (gange 16) og saa
 * "StreamTitle='Kunstner - Titel';". Bilen (NorRadio) faar den fra
 * ExoPlayer; her laeses den af en lille sidestroem, saa afspilleren ikke
 * skal roeres. Samme regler for hvad der er en sang som NowPlaying.kt.
 */

export interface NowPlayingInfo {
  artist: string;
  track: string;
}

const SHAPE = /^\s*\/?\s*(.{1,80}?)\s+[-–]\s+(.{1,120}?)\s*$/;
const NOISE = /(https?:\/\/|www\.|\.com\b|\.dk\b|\.de\b|\.net\b|shopify|advert|reklame|commercial)/i;

/** Null naar linjen ikke er en sang: tom, for lang, en beskrivelse, en reklame, eller stationens navn. */
export function parseNowPlaying(raw: string, stationName: string): NowPlayingInfo | null {
  const text = raw.trim();
  if (text.length === 0 || text.length > 200) return null;
  if (NOISE.test(text)) return null;
  if (text.split(/\s+/).length > 16) return null;
  const match = SHAPE.exec(text);
  if (match === null || match[1] === undefined || match[2] === undefined) return null;
  const artist = match[1].trim();
  const track = match[2].trim();
  if (artist.length === 0 || track.length === 0) return null;
  if (artist.toLowerCase() === track.toLowerCase()) return null;
  const station = stationName.toLowerCase();
  if (artist.toLowerCase() === station || track.toLowerCase() === station) return null;
  return { artist, track };
}

/** "StreamTitle='...';" ud af en metadatablok. Null naar der ingen titel er. */
export function extractStreamTitle(block: string): string | null {
  const match = /StreamTitle='((?:[^']|'(?!;))*)'/.exec(block);
  if (match === null || match[1] === undefined) return null;
  return match[1].trim();
}

/** UTF-8 naar det kan lade sig goere, ellers Latin-1: aeldre servere sender det sidste. */
export function decodeBytes(bytes: Uint8Array): string {
  try {
    if (typeof TextDecoder !== 'undefined') return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    // Ikke gyldig UTF-8.
  }
  let out = '';
  for (const byte of bytes) out += String.fromCharCode(byte);
  return out;
}

/**
 * Finder den foerste metadatablok med indhold i en stroem af bytes.
 *
 * `push` faar lydens bytes som de kommer og svarer med blokken som tekst,
 * naar den er laest helt. Tomme blokke (laengde 0) betyder "uaendret" og
 * springes over; efter `maxBytes` gives op, saa en station der aldrig
 * sender titel ikke holder en forbindelse aaben.
 */
export class IcyScanner {
  private skip: number;
  private blockLength = -1;
  private block: number[] = [];
  private seen = 0;

  constructor(
    private readonly metaint: number,
    private readonly maxBytes: number = metaint * 3 + 4096,
  ) {
    this.skip = metaint;
  }

  /** Sand naar der ikke skal laeses mere. */
  get exhausted(): boolean {
    return this.seen >= this.maxBytes;
  }

  push(chunk: Uint8Array): string | null {
    this.seen += chunk.length;
    let i = 0;
    while (i < chunk.length) {
      if (this.skip > 0) {
        const n = Math.min(this.skip, chunk.length - i);
        this.skip -= n;
        i += n;
        continue;
      }
      if (this.blockLength < 0) {
        this.blockLength = (chunk[i] ?? 0) * 16;
        i += 1;
        if (this.blockLength === 0) {
          this.blockLength = -1;
          this.skip = this.metaint;
        }
        continue;
      }
      const n = Math.min(this.blockLength - this.block.length, chunk.length - i);
      for (let k = 0; k < n; k += 1) this.block.push(chunk[i + k] ?? 0);
      i += n;
      if (this.block.length >= this.blockLength) {
        const text = decodeBytes(Uint8Array.from(this.block)).replace(/\0+$/, '');
        this.block = [];
        this.blockLength = -1;
        this.skip = this.metaint;
        if (text.trim().length > 0) return text;
      }
    }
    return null;
  }
}

/** "(Felix Cartal Remix)" og "[Radio Edit]" forstyrrer soegningen mere end de hjaelper. */
export function cleanTrack(track: string): string {
  const cleaned = track.replace(/\s*[([].*?[)\]]/g, '').trim();
  return cleaned.length > 0 ? cleaned : track;
}

export function itunesSearchUrl(playing: NowPlayingInfo): string {
  const term = encodeURIComponent(`${playing.artist} ${cleanTrack(playing.track)}`);
  return `https://itunes.apple.com/search?term=${term}&entity=song&limit=3&country=dk`;
}

/** Coveret i 600 px ud af iTunes' svar, eller null. */
export function coverFromItunes(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as { results?: Array<{ artworkUrl100?: unknown }> };
    for (const result of parsed.results ?? []) {
      const url = result.artworkUrl100;
      if (typeof url === 'string' && url.startsWith('http')) return url.replace('100x100', '600x600');
    }
  } catch {
    // Ikke JSON.
  }
  return null;
}

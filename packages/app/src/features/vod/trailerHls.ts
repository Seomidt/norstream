/** En variant i et HLS-hovedmanifest. */
export interface HlsVariant {
  /** `#EXT-X-STREAM-INF`-linjen, uaendret. */
  inf: string;
  uri: string;
  height: number;
  width: number;
  bandwidth: number;
  codecs: string;
  audio: string | null;
}

function attribute(line: string, name: string): string | null {
  const match = new RegExp(`(?:^|[:,])${name}=("([^"]*)"|[^,]*)`).exec(line);
  if (match === null) return null;
  return match[2] ?? match[1] ?? null;
}

function absolute(uri: string, base: string): string {
  if (/^https?:\/\//.test(uri)) return uri;
  const origin = /^(https?:\/\/[^/]+)/.exec(base)?.[1] ?? '';
  if (uri.startsWith('/')) return origin + uri;
  return base.slice(0, base.lastIndexOf('/') + 1) + uri;
}

export function parseHlsVariants(text: string, base: string): HlsVariant[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const out: HlsVariant[] = [];
  for (let i = 0; i < lines.length; i++) {
    const inf = lines[i] ?? '';
    if (!inf.startsWith('#EXT-X-STREAM-INF:')) continue;
    let j = i + 1;
    while (j < lines.length && ((lines[j] ?? '') === '' || (lines[j] ?? '').startsWith('#'))) j++;
    const uri = lines[j];
    if (uri === undefined) continue;
    const resolution = attribute(inf, 'RESOLUTION') ?? '';
    out.push({
      inf,
      uri: absolute(uri, base),
      height: Number(/x(\d+)$/.exec(resolution)?.[1] ?? 0),
      width: Number(/^(\d+)x/.exec(resolution)?.[1] ?? 0),
      bandwidth: Number(attribute(inf, 'BANDWIDTH') ?? 0),
      codecs: attribute(inf, 'CODECS') ?? '',
      audio: attribute(inf, 'AUDIO'),
    });
  }
  return out;
}

/**
 * Et hovedmanifest med KUN den bedste variant op til maxHeight (H.264 foerst)
 * og dens lydspor — saa afspilleren starter i HD i stedet for at begynde lavt.
 * Null hvis manifestet ikke kan laeses.
 */
export function buildHlsMaster(
  text: string,
  base: string,
  maxHeight = 1080,
  requireHd = false,
): { playlist: string; height: number; firstUri: string } | null {
  if (!text.startsWith('#EXTM3U')) return null;
  const variants = parseHlsVariants(text, base).filter((v) => v.height > 0 && v.height <= maxHeight &&
    (!requireHd || (v.width >= 1280 && v.width <= 1920 && v.codecs.includes('avc1') && v.codecs.includes('mp4a'))));
  // Samme hoejde: AAC-lyd (mp4a) foer Dolby (ac-3/ec-3), som ikke alle
  // telefoner og bokse kan afkode — Apple TV tilbyder hver kvalitet med alle
  // tre (v336). Saa hoejeste bitrate.
  const aac = (v: HlsVariant): number => (v.codecs.includes('mp4a') ? 1 : 0);
  const byQuality = (a: HlsVariant, b: HlsVariant): number =>
    b.height - a.height || aac(b) - aac(a) || b.bandwidth - a.bandwidth;
  const h264 = variants.filter((v) => v.codecs.includes('avc1')).sort(byQuality);
  const chosen = h264[0] ?? [...variants].sort(byQuality)[0];
  if (chosen === undefined) return null;
  const lines = ['#EXTM3U'];
  if (text.includes('#EXT-X-INDEPENDENT-SEGMENTS')) lines.push('#EXT-X-INDEPENDENT-SEGMENTS');
  if (chosen.audio !== null) {
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line.startsWith('#EXT-X-MEDIA:') || attribute(line, 'GROUP-ID') !== chosen.audio) continue;
      const uri = attribute(line, 'URI');
      lines.push(uri === null ? line : line.replace(`URI="${uri}"`, `URI="${absolute(uri, base)}"`).replace(/,?PATHWAY-ID="[^"]*"/g, ''));
    }
  }
  if (requireHd && chosen.audio !== null && !lines.some((line) => line.startsWith('#EXT-X-MEDIA:') && line.includes('URI='))) return null;
  // Undertekst-gruppen tages ikke med; henvisningen til den fjernes derfor.
  const inf = chosen.inf.replace(/,?SUBTITLES="[^"]*"/, '').replace(/,?(?:PATHWAY-ID|STABLE-VARIANT-ID)="[^"]*"/g, '').replace('#EXT-X-STREAM-INF:,', '#EXT-X-STREAM-INF:');
  lines.push(inf, chosen.uri, '');
  return { playlist: lines.join('\n'), height: chosen.height, firstUri: chosen.uri };
}


import type { VideoSource } from 'expo-video';

/** Kun Androids sekventielle TS-arkiv. Live, HLS og andre platforme bevares. */
export function archiveQueueSource(
  source: VideoSource,
  segment: { segmentStart: number; playbackStop: Date; panelOffsetMinutes: number; dialect: string; format: string } | null,
  token: number,
  android: boolean,
): VideoSource {
  if (!android || segment === null || (segment.dialect !== 'php' && segment.format !== 'ts')) return source;
  const record = typeof source === 'string' ? { uri: source } : source;
  if (record === null || typeof record !== 'object' || !record.uri) return source;
  // Native holder samme afspiller og ur. Kun fuldt hentede kilder faar en
  // efterfoelger, saa panelets ene medieforbindelse er fri inden naeste GET.
  return {
    ...record,
    norstreamArchive: {
      startMs: segment.segmentStart,
      stopMs: segment.playbackStop.getTime(),
      offsetMinutes: segment.panelOffsetMinutes,
      token,
      clipMs: 0,
    },
  } as VideoSource;
}

/** Ingen adresser eller native fejltekster i den automatiske log. */
export function archiveQueueSummary(event: { phase?: unknown; leadSeconds?: unknown; overlapSeconds?: unknown; transitions?: unknown }): string | null {
  if (!['koesat', 'overgang', 'afventer', 'tilbagefald'].includes(String(event.phase))) return null;
  const values = [event.leadSeconds, event.overlapSeconds, event.transitions];
  if (values.some(v => typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 172800)) return null;
  return `arkivkoe v395: ${event.phase}; buffer ${(event.leadSeconds as number).toFixed(3)} s; overlap ${(event.overlapSeconds as number).toFixed(3)} s; skift ${event.transitions}`;
}

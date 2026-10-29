import type { PlayerBuilderOptions } from 'expo-video';

// Opt-in i den ene vedvarende TV-afspiller. En ny option pr. arkivstykke
// ville fa useVideoPlayer til at genskabe afspilleren og tabe dens buffer.
export const TV_CODEC_OPTIONS: PlayerBuilderOptions & { norstreamSynchronousCodec: true } = Object.freeze({
  norstreamSynchronousCodec: true,
});

/** Faste profiler: aldrig en ny afspiller ved kanal- eller arkivskift. */
export const TV_UNIFORM_AUDIO_OPTIONS = Object.freeze({
  ...TV_CODEC_OPTIONS,
  norstreamUniformAudio: true,
});
export const PREVIEW_UNIFORM_AUDIO_OPTIONS: PlayerBuilderOptions & { norstreamUniformAudio: true } = Object.freeze({ norstreamUniformAudio: true });

export interface VideoFrameSample {
  videoQueuedFrames?: number | null;
  videoRenderedFrames?: number | null;
  videoDroppedFrames?: number | null;
  bufferedPosition?: number;
  /** Ufiltreret native buffer (v424); expo's bufferedPosition melder 0 under buffering. */
  nativeBufferedPosition?: number | null;
  netLoads?: number | null;
  netErrors?: number | null;
  netLastKilobytes?: number | null;
  netLastDurationMs?: number | null;
  netLastHttpStatus?: number | null;
  netLastLengthKnown?: boolean | null;
}

/**
 * Netvaerket set fra Media3, som tal (v424): hvor mange indlaesninger og fejl,
 * hvad den sidste gav, og hvor langt den ufiltrerede buffer naar. Skelner
 * "panelet lukkede efter N kB" fra "netfejl" og "sultet". Ingen adresser.
 */
export function netSummary(sample: VideoFrameSample | null, position: number): string {
  if (sample === null) return 'net: ingen native tal endnu';
  const int = (value: number | null | undefined): string => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? String(Math.round(value)) : '?';
  const ahead = typeof sample.nativeBufferedPosition === 'number' && Number.isFinite(sample.nativeBufferedPosition) && Number.isFinite(position)
    ? Math.max(0, sample.nativeBufferedPosition - position).toFixed(1) : '?';
  const known = sample.netLastLengthKnown === true ? 'ja' : sample.netLastLengthKnown === false ? 'nej' : '?';
  return `net v424: indlaesninger ${int(sample.netLoads)}, fejl ${int(sample.netErrors)}; sidste ${int(sample.netLastKilobytes)} kB paa ${int(sample.netLastDurationMs)} ms, http ${int(sample.netLastHttpStatus)}, laengde kendt ${known}; native buffer foran ${ahead} s`;
}

// Kun faste navne og sikre tal; ingen native fejltekst, URL eller credentials.
export function videoFrameSummary(sample: VideoFrameSample, position: number): string | null {
  const counts = [sample.videoQueuedFrames, sample.videoRenderedFrames, sample.videoDroppedFrames];
  if (!Number.isFinite(position) || position < 0 || counts.some((n) => !Number.isSafeInteger(n) || (n as number) < 0 || (n as number) > 2_147_483_647)) return null;
  const buffered = typeof sample.bufferedPosition === 'number' && Number.isFinite(sample.bufferedPosition) && sample.bufferedPosition >= 0
    ? Math.round(sample.bufferedPosition) : '?';
  return `video-sync v381: ved ${position.toFixed(3)} s; ind ${counts[0]}, vist ${counts[1]}, tabt ${counts[2]}; buffer til ${buffered} s`;
}

import type { PlayerBuilderOptions } from 'expo-video';

// Opt-in i den ene vedvarende TV-afspiller. En ny option pr. arkivstykke
// ville fa useVideoPlayer til at genskabe afspilleren og tabe dens buffer.
export const TV_CODEC_OPTIONS: PlayerBuilderOptions & { norstreamSynchronousCodec: true } = Object.freeze({
  norstreamSynchronousCodec: true,
});

export interface VideoFrameSample {
  videoQueuedFrames?: number | null;
  videoRenderedFrames?: number | null;
  videoDroppedFrames?: number | null;
  bufferedPosition?: number;
}

// Kun faste navne og sikre tal; ingen native fejltekst, URL eller credentials.
export function videoFrameSummary(sample: VideoFrameSample, position: number): string | null {
  const counts = [sample.videoQueuedFrames, sample.videoRenderedFrames, sample.videoDroppedFrames];
  if (!Number.isFinite(position) || position < 0 || counts.some((n) => !Number.isSafeInteger(n) || (n as number) < 0 || (n as number) > 2_147_483_647)) return null;
  const buffered = typeof sample.bufferedPosition === 'number' && Number.isFinite(sample.bufferedPosition) && sample.bufferedPosition >= 0
    ? Math.round(sample.bufferedPosition) : '?';
  return `video-sync v381: ved ${position.toFixed(3)} s; ind ${counts[0]}, vist ${counts[1]}, tabt ${counts[2]}; buffer til ${buffered} s`;
}

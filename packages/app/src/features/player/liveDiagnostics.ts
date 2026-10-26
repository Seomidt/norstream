/** Diagnostik uden kanaladresse, kodeord eller raa native fejltekst. */
export type LiveFailureReason = 'native' | 'klargoering' | 'idle' | 'buffer-timeout' | 'eof' | 'ur-stoppet';
interface SamplePort {
  currentTime: number;
  bufferedPosition: number;
  playing: boolean;
  status: string;
  readonly duration?: number;
  readonly isLive?: boolean;
}
function number(read: () => unknown): number | null {
  try {
    const value = read();
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1e8 ? value : null;
  } catch { return null; }
}
/** Sidste videotaellere fra timeUpdate (kun TV i dag): skiller "ur gaar, billede staar" fra sult. */
export interface FrameCounters { videoQueuedFrames?: number | null; videoRenderedFrames?: number | null; videoDroppedFrames?: number | null }

export function liveFailureSnapshot(player: SamplePort, reason: LiveFailureReason, format: 'ts' | 'hls', frames: FrameCounters | null = null): string {
  const position = number(() => player.currentTime), buffered = number(() => player.bufferedPosition);
  const ahead = position === null || buffered === null ? null : Math.max(0, buffered - position);
  let status = '?', playing = '?', nativeLive = '?';
  try {
    const raw = player.status;
    if (['idle', 'loading', 'readyToPlay', 'error'].includes(raw)) status = raw;
    playing = player.playing === true ? 'ja' : 'nej';
  } catch { /* Frigivet afspiller: ingen raa fejltekst. */ }
  try {
    if (typeof player.isLive === 'boolean') nativeLive = player.isLive ? 'ja' : 'nej';
  } catch { /* Native metadata kan vaere frigivet. */ }
  const duration = number(() => player.duration);
  const text = (value: number | null): string => value === null ? '?' : value.toFixed(1);
  const count = (value: number | null | undefined): string => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? String(value) : '?';
  const counters = frames === null ? '' : `; billeder ind ${count(frames.videoQueuedFrames)}, vist ${count(frames.videoRenderedFrames)}, tabt ${count(frames.videoDroppedFrames)}`;
  return `live-diagnose v417: ${reason}, ${format}, ${status}, spiller ${playing}; ur ${text(position)} s, buffer til ${text(buffered)} s, foran ${text(ahead)} s; native live ${nativeLive}, varighed ${text(duration)} s${counters}`;
}

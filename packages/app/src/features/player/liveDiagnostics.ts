/** Diagnostik uden kanaladresse, kodeord eller raa native fejltekst. */
export type LiveFailureReason = 'native' | 'klargoering' | 'idle' | 'buffer-timeout' | 'eof' | 'ur-stoppet';
interface SamplePort {
  currentTime: number;
  bufferedPosition: number;
  playing: boolean;
  status: string;
}
function number(read: () => unknown): number | null {
  try {
    const value = read();
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1e8 ? value : null;
  } catch { return null; }
}
export function liveFailureSnapshot(player: SamplePort, reason: LiveFailureReason, format: 'ts' | 'hls'): string {
  const position = number(() => player.currentTime), buffered = number(() => player.bufferedPosition);
  const ahead = position === null || buffered === null ? null : Math.max(0, buffered - position);
  let status = '?', playing = '?';
  try {
    const raw = player.status;
    if (['idle', 'loading', 'readyToPlay', 'error'].includes(raw)) status = raw;
    playing = player.playing === true ? 'ja' : 'nej';
  } catch { /* Frigivet afspiller: ingen raa fejltekst. */ }
  const text = (value: number | null): string => value === null ? '?' : value.toFixed(1);
  return `live-diagnose v403: ${reason}, ${format}, ${status}, spiller ${playing}; ur ${text(position)} s, buffer til ${text(buffered)} s, foran ${text(ahead)} s`;
}

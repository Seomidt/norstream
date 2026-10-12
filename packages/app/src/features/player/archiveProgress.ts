export interface ArchiveProgressTime {
  elapsed: number;
  duration: number;
  remaining: number;
}

/** Hele udsendelsens ur, ikke varigheden af panelets nuvaerende arkivstykke. */
export function archiveProgressTime(
  programme: { start: Date; stop: Date },
  segmentStart: number,
  position: number,
): ArchiveProgressTime | null {
  const start = programme.start.getTime();
  const seconds = (programme.stop.getTime() - start) / 1000;
  const absolute = (segmentStart - start) / 1000 + position;
  if (!Number.isFinite(seconds) || seconds <= 0 || !Number.isFinite(absolute)) return null;
  const duration = Math.ceil(seconds);
  const elapsed = Math.max(0, Math.min(duration, Math.floor(absolute)));
  return { elapsed, duration, remaining: duration - elapsed };
}

export function archiveTimeLabel(seconds: number): string {
  const value = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor(value / 60) % 60;
  const remainder = String(value % 60).padStart(2, '0');
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${remainder}` : `${minutes}:${remainder}`;
}

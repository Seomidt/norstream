import type { ArchiveProgressTime } from '../player/archiveProgress.js';

/** Native filtid for filmen eller det aktuelle afsnit; aldrig katalogets varighed. */
export function vodProgressTime(position: number, seconds: number): ArchiveProgressTime | null {
  if (!Number.isFinite(position) || !Number.isFinite(seconds) || seconds <= 0) return null;
  const duration = Math.ceil(seconds);
  const elapsed = position >= seconds ? duration : Math.max(0, Math.floor(position));
  return { elapsed, duration, remaining: duration - elapsed };
}

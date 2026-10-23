import { WATCHED_RATIO } from '../../storage/vod.js';

/** Set faerdig betyder "se igen", aldrig et hop til den gamle slutposition. */
export function vodResumeAt(progress: {
  watched: boolean;
  positionSeconds: number | null;
  durationSeconds: number | null;
}): number | null {
  if (progress.watched) return null;
  return safeVodResume(progress.positionSeconds, progress.durationSeconds);
}

/** Native varighed kan vaere kortere end den gemte; soeg aldrig til slut. */
export function safeVodResume(position: number | null, duration: number | null): number | null {
  if (position === null || !Number.isFinite(position) || position <= 0) return null;
  if (duration !== null && Number.isFinite(duration) && duration > 0 && position >= duration * WATCHED_RATIO) return null;
  return position;
}

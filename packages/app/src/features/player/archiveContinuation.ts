/**
 * Hvad start-forfra skal goere, naar arkiv-streamen slutter foer udsendelsen.
 *
 * Panelet leverer arkivet som det ligger NAAR man beder om det. Starter man
 * en udsendelse forfra mens den sendes, slutter streamen dér hvor man
 * trykkede — midt i udsendelsen. Og hakker en arkiv-stream, startede en
 * genforbindelse forfra fra udsendelsens begyndelse. I stedet beder vi om
 * arkivet igen fra det punkt man naaede til, indtil udsendelsen er slut eller
 * man har indhentet live.
 */
export type ArchiveNext =
  /** Hent arkivet igen fra `from` (hele minutter, som panelet vil have det) og spol `seekSeconds` frem. */
  | { kind: 'continue'; from: Date; seekSeconds: number; minutes: number }
  /** Indhentet den levende kant, og udsendelsen sendes stadig: skift til live. */
  | { kind: 'live' }
  /** Udsendelsen er set til ende (eller sluttede): intet at goere. */
  | { kind: 'done' };

/** Arkivet halter lidt efter live; tættere paa end det er der intet at hente. */
export const LIVE_EDGE_LAG_MS = 90_000;
/** De sidste sekunder af en udsendelse regnes som set til ende. */
const END_SLACK_MS = 30_000;

export function archiveContinuation(
  programme: { start: Date; stop: Date },
  segmentStartMs: number,
  positionSeconds: number,
  nowMs: number,
): ArchiveNext {
  const position = Number.isFinite(positionSeconds) && positionSeconds > 0 ? positionSeconds : 0;
  const reached = segmentStartMs + position * 1000;
  const end = programme.stop.getTime();
  if (reached >= end - END_SLACK_MS) return { kind: 'done' };
  if (reached >= nowMs - LIVE_EDGE_LAG_MS) return end > nowMs ? { kind: 'live' } : { kind: 'done' };
  const from = Math.floor(reached / 60_000) * 60_000;
  return {
    kind: 'continue',
    from: new Date(from),
    seekSeconds: (reached - from) / 1000,
    minutes: Math.max(1, Math.ceil((end - from) / 60_000)),
  };
}

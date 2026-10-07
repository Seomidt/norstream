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
  /** Panelet mangler det naeste faerdige minut; behold positionen og vent. */
  | { kind: 'wait' }
  /** Udsendelsen er set til ende (eller sluttede): intet at goere. */
  | { kind: 'done' };

/** Arkivet halter lidt efter live; tættere paa end det er der intet at hente. */
export const LIVE_EDGE_LAG_MS = 90_000;
/** De sidste sekunder af en udsendelse regnes som set til ende. */
const END_SLACK_MS = 2000;

/** Panelet accepterer kun starttid og varighed i HELE minutter. */
export function archiveWindow(
  programme: { start: Date; stop: Date },
  from: Date,
  seekSeconds: number,
  nowMs: number,
): { from: Date; seekSeconds: number; minutes: number } | null {
  const origin = Math.floor(from.getTime() / 60_000) * 60_000;
  const availableEnd = Math.min(programme.stop.getTime(), nowMs - LIVE_EDGE_LAG_MS);
  const complete = programme.stop.getTime() <= nowMs - LIVE_EDGE_LAG_MS;
  const minutes = complete
    ? Math.ceil((availableEnd - origin) / 60_000)
    : Math.floor((availableEnd - origin) / 60_000);
  // Rund ikke et igangvaerende arkiv op ud over sikkerhedsafstanden. Et
  // helt nyt program kan endnu ikke have et eneste faerdigt arkivminut.
  if (minutes < 1) return null;
  return {
    from: new Date(origin),
    seekSeconds: Math.max(0, seekSeconds) + (from.getTime() - origin) / 1000,
    minutes,
  };
}

export function archiveContinuation(
  programme: { start: Date; stop: Date },
  segmentStartMs: number,
  positionSeconds: number,
  nowMs: number,
): ArchiveNext {
  const position = Number.isFinite(positionSeconds) && positionSeconds > 0 ? positionSeconds : 0;
  const rawReached = segmentStartMs + position * 1000;
  // Native tid kan ligge 1 ms under et helt minut, mens loggen viser 120 s.
  // Date trunkerer og gjorde det til forrige minut + 59.999 s: unoedigt seek
  // gennem et helt overlap. Kun 1 ms normaliseres; reelle 154/179/596 s fra
  // TV-loggen bevares, ogsaa naar panelet leverer mindre end bestilt.
  const nearestMinute = Math.round(rawReached / 60_000) * 60_000;
  const reached = Math.abs(rawReached - nearestMinute) <= 1 ? nearestMinute : rawReached;
  const end = programme.stop.getTime();
  if (reached >= end - END_SLACK_MS) return { kind: 'done' };
  if (reached >= nowMs && end > nowMs) return { kind: 'live' };
  const window = archiveWindow(programme, new Date(reached), 0, nowMs);
  if (window === null || window.seekSeconds >= window.minutes * 60 - 1) return { kind: 'wait' };
  return {
    kind: 'continue',
    ...window,
  };
}

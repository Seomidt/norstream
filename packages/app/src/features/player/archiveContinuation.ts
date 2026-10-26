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
  /** Udsendelse og slutmargen er naaet; afslut automatisk. */
  | { kind: 'done' };

/** Arkivet halter lidt efter live; tættere paa end det er der intet at hente. */
export const LIVE_EDGE_LAG_MS = 90_000;
/** EPG-tider er planlagte tider, ikke en garanti for sidste billede. */
export const ARCHIVE_END_MARGIN_MINUTES = 15;
export const ARCHIVE_END_MARGIN_MS = ARCHIVE_END_MARGIN_MINUTES * 60_000;

/** Afspilningsgraensen holdes adskilt fra programmets titel og EPG-tider.
 * Graensen bevares ved genforbindelse og spoling. */
export function archivePlaybackBounds(
  programme: { start: Date; stop: Date },
  untilMs?: number,
): { start: Date; stop: Date; liveStop: Date } {
  const minimum = programme.stop.getTime() + ARCHIVE_END_MARGIN_MS;
  return {
    start: programme.start,
    stop: new Date(typeof untilMs === 'number' && Number.isFinite(untilMs) ? Math.max(minimum, untilMs) : minimum),
    liveStop: programme.stop,
  };
}
/** De sidste sekunder af en udsendelse regnes som set til ende. */
const END_SLACK_MS = 2000;

/**
 * Panelets arkivstykke slutter typisk 1-2 s foer det bestilte hele minut
 * (v419-loggen: 478,290 s for 8 min; TV2-loggen: 179,340 s for 3 min).
 * Foer blev de sidste sekunder til et overlap paa 58-59 s: naeste stykke
 * blev bestilt fra det forrige minut med spoling, og Media3 maatte hente
 * og kassere et helt minut igen ved hvert stykkeskift (v424). Et stykke
 * der slutter inden for denne margen regnes for at have naaet minuttet,
 * saa det naeste begynder dér uden spoling. Hoejst fem sekunder indhold
 * springes over, og det er sekunder panelet alligevel ikke leverede.
 */
export const MINUTE_SHORTFALL_TOLERANCE_MS = 5000;

/** Panelet accepterer kun starttid og varighed i HELE minutter. */
export function archiveWindow(
  programme: { start: Date; stop: Date },
  from: Date,
  seekSeconds: number,
  nowMs: number,
): { from: Date; seekSeconds: number; minutes: number } | null {
  const seek = Number.isFinite(seekSeconds) ? Math.max(0, seekSeconds) : 0;
  // Hent fra det minut der faktisk skal ses, og behold kun sekund-overlap.
  // Et resume paa fx 320 s maa ikke hente de foerste fem minutter igen og
  // derefter vaere afhaengigt af panelets byte-seek i en sammenfoejet TS.
  const requested = from.getTime() + seek * 1000;
  const origin = Math.floor(requested / 60_000) * 60_000;
  if (!Number.isFinite(origin)) return null;
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
    seekSeconds: (requested - origin) / 1000,
    minutes,
  };
}

export function archiveContinuation(
  programme: { start: Date; stop: Date; liveStop?: Date },
  segmentStartMs: number,
  positionSeconds: number,
  nowMs: number,
): ArchiveNext {
  const position = Number.isFinite(positionSeconds) && positionSeconds > 0 ? positionSeconds : 0;
  const rawReached = segmentStartMs + position * 1000;
  // Et stykke der slutter lige foer et helt minut (op til fem sekunder, se
  // MINUTE_SHORTFALL_TOLERANCE_MS) eller 1 ms efter det, regnes som naaet
  // til minuttet. Reelle 154 s fra TV-loggen (26 s foer minuttet) bevares,
  // ogsaa naar panelet leverer mindre end bestilt.
  const nextMinute = Math.ceil(rawReached / 60_000) * 60_000;
  const previousMinute = Math.floor(rawReached / 60_000) * 60_000;
  const reached = nextMinute - rawReached <= MINUTE_SHORTFALL_TOLERANCE_MS ? nextMinute
    : rawReached - previousMinute <= 1 ? previousMinute : rawReached;
  const end = programme.stop.getTime();
  if (reached >= end - END_SLACK_MS) return { kind: 'done' };
  // Slutmargenen maa ikke faa en faerdig udsendelse til at ligne en der
  // stadig sendes og dermed udloese et utilsigtet spring til live.
  if (reached >= nowMs && (programme.liveStop?.getTime() ?? end) > nowMs) return { kind: 'live' };
  const window = archiveWindow(programme, new Date(reached), 0, nowMs);
  if (window === null || window.seekSeconds >= window.minutes * 60 - 1) return { kind: 'wait' };
  return {
    kind: 'continue',
    ...window,
  };
}

import type { Programme } from '@norstream/core';

/**
 * Guidens tidsgitter, som ren beregning.
 *
 * Skaermen tegner kun det denne fil returnerer. Det er bevidst: layoutet er
 * det sted i guiden hvor en fejl er stille — en celle der er et par minutter
 * for bred ser rigtig ud — og skaermkomponenter er det eneste lag appen ikke
 * har tests for.
 */

export type CellState =
  /** Sendes nu. */
  | 'live'
  /** Er slut. */
  | 'past'
  /** Kommer senere. */
  | 'future'
  /** Hul i programdata. */
  | 'gap';

export interface GuideCell {
  key: string;
  /** Null for huller. */
  programme: Programme | null;
  state: CellState;
  /** Cellens andel af vinduet i minutter. Bruges som flex-vaegt. */
  weight: number;
  /** Sand naar programmet begyndte foer vinduet og er klippet i venstre kant. */
  clippedStart: boolean;
  /** Sand naar programmet slutter efter vinduet. */
  clippedEnd: boolean;
}

/** Guidens vindue er to timer ad gangen. Mere end det er ulaeseligt paa en telefon. */
export const WINDOW_MINUTES = 120;

/**
 * Vinduet for en given side, forankret til nærmeste halve time foer `now`.
 *
 * Forankringen goer at kolonnerne staar paa 19:00 og 19:30 frem for paa
 * 19:07 — og at siderne bliver ved med at staa der, uanset hvornaar brugeren
 * aabnede guiden.
 */
export function guideWindow(
  now: Date,
  page = 0,
  windowMinutes: number = WINDOW_MINUTES,
): { start: Date; end: Date } {
  const halfHourMs = 30 * 60_000;
  const anchored = Math.floor(now.getTime() / halfHourMs) * halfHourMs;
  const start = anchored + page * windowMinutes * 60_000;
  return { start: new Date(start), end: new Date(start + windowMinutes * 60_000) };
}

function stateOf(programme: Programme, now: Date): CellState {
  const ms = now.getTime();
  if (programme.stop.getTime() <= ms) return 'past';
  if (programme.start.getTime() > ms) return 'future';
  return 'live';
}

/**
 * Laegger én kanals raekke ud over vinduet.
 *
 * Programmer klippes til vinduets kanter, saa en udsendelse der begyndte foer
 * vinduet stadig fylder sin rigtige del af det. Manglende programdata bliver
 * til en `gap`-celle frem for at cellerne skrider sammen — ellers ville et hul
 * mellem 20:00 og 21:00 skubbe aftenens programmer en time til venstre og
 * vise et forkert tidspunkt for dem alle.
 *
 * `programmes` forventes sorteret efter starttidspunkt, som `mapShortEpg`
 * leverer dem. Overlappende programmer klippes mod det foregaaende, saa
 * summen af vaegte altid er praecis vinduets laengde.
 */
export function layoutRow(
  programmes: readonly Programme[],
  windowStart: Date,
  windowEnd: Date,
  now: Date,
): GuideCell[] {
  const startMs = windowStart.getTime();
  const endMs = windowEnd.getTime();
  if (endMs <= startMs) return [];

  const cells: GuideCell[] = [];
  let cursor = startMs;

  const pushGap = (until: number): void => {
    if (until <= cursor) return;
    cells.push({
      key: `gap-${cursor}`,
      programme: null,
      state: 'gap',
      weight: (until - cursor) / 60_000,
      clippedStart: false,
      clippedEnd: false,
    });
    cursor = until;
  };

  for (const programme of programmes) {
    const programmeStart = programme.start.getTime();
    const programmeStop = programme.stop.getTime();
    if (programmeStop <= startMs || programmeStart >= endMs) continue;

    const from = Math.max(programmeStart, cursor);
    const to = Math.min(programmeStop, endMs);
    // Helt daekket af et foregaaende, overlappende program.
    if (to <= from) continue;

    pushGap(from);
    cells.push({
      key: `p-${programmeStart}`,
      programme,
      state: stateOf(programme, now),
      weight: (to - from) / 60_000,
      clippedStart: programmeStart < startMs,
      clippedEnd: programmeStop > endMs,
    });
    cursor = to;
  }

  pushGap(endMs);
  return cells;
}

export type GuideAction =
  /** Afspil kanalen live. */
  | 'play'
  /** Start programmet forfra fra arkivet. */
  | 'restart'
  /** Feltet er inaktivt. */
  | 'none';

/**
 * Spec sec.8's tabel, som én funktion.
 *
 * | Programmet | Handling |
 * |---|---|
 * | sendes nu | afspil kanalen |
 * | er slut, og kanalen har arkiv | start forfra fra programmets starttidspunkt |
 * | er slut, uden arkiv | ingenting |
 * | kommer senere | ingenting |
 *
 * `hasDialect` er om panelets timeshift-dialekt er fundet. Uden den kan der
 * ikke bygges en arkiv-URL, uanset hvad kanalen paastaar om sit arkiv.
 */
export function guideAction(
  cell: GuideCell,
  channel: { hasArchive: boolean },
  hasDialect: boolean,
): GuideAction {
  if (cell.programme === null) return 'none';
  if (cell.state === 'live') return 'play';
  if (cell.state === 'past' && channel.hasArchive && hasDialect) return 'restart';
  return 'none';
}

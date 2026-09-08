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
  return shiftedWindow(now, page * windowMinutes, windowMinutes);
}

/**
 * Hvor langt guiden maa traekkes bagud og fremad, i minutter.
 *
 * Bagud foelger arkivet: laengere tilbage end en uge har intet panel gemt, og
 * en tom guide man kan blive ved med at traekke i, foeles som om appen har
 * mistet sine data. Fremad foelger programoversigten, som sjaeldent raekker
 * mere end en uge frem.
 */
export const DRAG_MIN_MINUTES = -7 * 24 * 60;
export const DRAG_MAX_MINUTES = 7 * 24 * 60;

/**
 * Forskydningen der stiller vinduet paa et bestemt klokkeslaet en bestemt
 * dag: `dayDelta` dage fra i dag, klokken `hour`. Bruges af dagsknapperne,
 * saa "i morgen aften" er ét tryk og ikke tolv traek. Klemt til det samme
 * spaend som traekket, saa knapperne ikke kan naa laengere end fingeren.
 */
export function offsetForTarget(now: Date, dayDelta: number, hour: number): number {
  const halfHourMs = 30 * 60_000;
  const anchored = Math.floor(now.getTime() / halfHourMs) * halfHourMs;
  const target = new Date(now);
  target.setDate(target.getDate() + dayDelta);
  target.setHours(hour, 0, 0, 0);
  const minutes = Math.round((target.getTime() - anchored) / 60_000);
  return Math.min(DRAG_MAX_MINUTES, Math.max(DRAG_MIN_MINUTES, minutes));
}

/**
 * Vinduet forskudt et vilkaarligt antal minutter fra nu.
 *
 * `guideWindow` flytter sig et helt vindue ad gangen, som pilene goer. Den her
 * flytter sig lige saa langt som en finger har trukket, saa gitteret foelger
 * med under bevaegelsen frem for at hoppe.
 *
 * Forankringen til den halve time bevares: traekker man tilbage til nul, staar
 * kolonnerne igen paa 19:00 og 19:30 og ikke paa et skaevt minuttal.
 */
export function shiftedWindow(
  now: Date,
  offsetMinutes: number,
  windowMinutes: number = WINDOW_MINUTES,
): { start: Date; end: Date } {
  const halfHourMs = 30 * 60_000;
  const anchored = Math.floor(now.getTime() / halfHourMs) * halfHourMs;
  const clamped = Math.min(DRAG_MAX_MINUTES, Math.max(DRAG_MIN_MINUTES, offsetMinutes));
  const start = anchored + clamped * 60_000;
  return { start: new Date(start), end: new Date(start + windowMinutes * 60_000) };
}

/**
 * Minutterne en vandret bevaegelse svarer til.
 *
 * Vinduet er praecis saa bredt som gitteret, saa en finger der flytter sig en
 * gittterbredde skal flytte tiden et helt vindue: saa foelger programmet under
 * fingeren med fingeren. Bevaegelsen gaar modsat — traekker man mod venstre,
 * kommer senere programmer frem, som naar man skubber et stykke papir.
 *
 * Resultatet trappes til hele skridt. Uden det ville hver eneste pixel give en
 * ny optegning af gitteret, og gevinsten ville vaere et minuttal ingen kan se
 * forskel paa.
 */
export function dragMinutes(
  dx: number,
  gridWidth: number,
  stepMinutes: number,
  windowMinutes: number = WINDOW_MINUTES,
): number {
  if (gridWidth <= 0 || stepMinutes <= 0) return 0;
  const minutes = (-dx / gridWidth) * windowMinutes;
  return Math.round(minutes / stepMinutes) * stepMinutes;
}

/**
 * Hvor "nu" ligger i vinduet, som en andel mellem 0 og 1 — eller null naar nu
 * ikke er i vinduet.
 *
 * Den bruges til at tegne en lodret streg ned gennem gitteret. Uden den kan
 * man ikke se hvor langt inde i den igangvaerende udsendelse man er, og efter
 * et traek bagud eller fremad er der ikke noget at forankre tiden i. Null er
 * en rigtig vaerdi: er nu uden for vinduet, skal der **ingen** streg vaere —
 * en streg i kanten ville paastaa at klokken er noget den ikke er.
 */
export function nowRatio(now: Date, windowStart: Date, windowEnd: Date): number | null {
  const from = windowStart.getTime();
  const to = windowEnd.getTime();
  if (to <= from) return null;
  const ms = now.getTime();
  if (ms < from || ms > to) return null;
  return (ms - from) / (to - from);
}

/** Hvor en udsendelse er i forhold til nu: slut, i gang, eller senere. */
export function stateOf(programme: Programme, now: Date): CellState {
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

export interface ProgrammeOptions {
  /** Se kanalen live. Altid muligt — det er bare at skifte kanal. */
  play: boolean;
  /** Afspil udsendelsen fra dens begyndelse via arkivet. */
  restart: boolean;
}

/**
 * Hvad man kan goere ved en udsendelse, samlet.
 *
 * `guideAction` giver den **ene** handling en celle udfoerer ved et tryk, og
 * bruges til markeringen i gitteret. Den her giver dem alle, til bladet der
 * aabnes naar man trykker: der er plads til at vise dem, og saa skal ingen
 * gaette paa hvad et tryk goer.
 *
 * En udsendelse der **er sendt** har ét svar: start forfra. Bladet viste
 * ogsaa "se kanalen", og det var forvirrende — man har rullet
 * tilbage til noget bestemt, og at se kanalen live er ikke det. Kan den ikke
 * startes forfra (intet arkiv, ingen dialekt), staar kanalen live tilbage
 * som det eneste, med forklaringen. Den der sendes lige nu faar alle tre.
 */
export function programmeOptions(
  state: CellState,
  channel: { hasArchive: boolean },
  hasDialect: boolean,
): ProgrammeOptions {
  const archive = channel.hasArchive && hasDialect;
  // Fremtiden kan ikke startes forfra; den er ikke sendt endnu.
  const restart = archive && state !== 'future' && state !== 'gap';
  if (state === 'past' && restart) return { play: false, restart: true };
  return { play: true, restart };
}

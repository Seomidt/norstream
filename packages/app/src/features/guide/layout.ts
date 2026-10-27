import type { Programme } from '@norstream/core';
import { archiveComplete } from '../player/archiveContinuation.js';

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

/**
 * Cellen der skal have fokus efter et vinduesskift paa tv (v353).
 *
 * `found` er pladsen for den udsendelse man stod paa, eller -1 naar den er
 * roeget ud af det nye vindue. `side` er -1 (pil venstre: udsendelsen FOER),
 * +1 (pil hoejre: den EFTER) eller 0 (samme). `atMs` er starttiden paa den
 * udsendelse man stod paa. Er den vaek, findes naboen paa tid: den sidste
 * udsendelse der begynder foer `atMs` (venstre) / den foerste der begynder
 * efter (hoejre); huller taeller ogsaa, saa man ikke springer over dem.
 * Kendes tiden ikke, tages sidste (venstre) / foerste (hoejre) celle.
 */
export function neighbourIndex(
  cells: readonly GuideCell[],
  found: number,
  side: -1 | 0 | 1,
  atMs: number | null,
  cellStart: (cell: GuideCell) => number | null = (cell) => cell.programme?.start.getTime() ?? null,
): number {
  if (cells.length === 0) return -1;
  const last = cells.length - 1;
  if (found !== -1) return Math.min(Math.max(0, found + side), last);
  if (side === 0) return 0;
  if (atMs !== null) {
    if (side === -1) {
      for (let i = last; i >= 0; i -= 1) {
        const start = cellStart(cells[i]!);
        if (start === null || start < atMs) return i;
      }
      return 0;
    }
    for (let i = 0; i <= last; i += 1) {
      const start = cellStart(cells[i]!);
      if (start === null || start > atMs) return i;
    }
    return last;
  }
  return side === -1 ? last : 0;
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
 * leverer dem. Ved overlap vinder den seneste start, som i nu/naeste-opslaget.
 * Summen af vaegte er altid praecis vinduets laengde.
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

  // Seneste start vinder et overlap, ligesom getNowNext. Originale
  // Programme-objekter bevares til arkivet; kun de tegnede intervaller deles.
  const valid = programmes.filter(p => Number.isFinite(p.start.getTime()) && Number.isFinite(p.stop.getTime())
    && p.stop.getTime() > p.start.getTime() && p.stop.getTime() > startMs && p.start.getTime() < endMs)
    .slice().sort((a, b) => a.start.getTime() - b.start.getTime());
  const bounds = [...new Set([startMs, endMs, ...valid.flatMap(p => [
    Math.max(startMs, p.start.getTime()), Math.min(endMs, p.stop.getTime()),
  ])])].sort((a, b) => a - b);
  const segments: Array<{ from: number; to: number; programme: Programme | null }> = [];
  for (let i = 0; i < bounds.length - 1; i += 1) {
    const from = bounds[i]!, to = bounds[i + 1]!;
    let programme: Programme | null = null;
    for (let j = valid.length - 1; j >= 0; j -= 1) {
      const candidate = valid[j]!;
      if (candidate.start.getTime() <= from && candidate.stop.getTime() > from) { programme = candidate; break; }
    }
    const last = segments[segments.length - 1];
    if (last !== undefined && last.programme === programme) last.to = to;
    else segments.push({ from, to, programme });
  }
  const nowMs = now.getTime();
  const inside = nowMs >= startMs && nowMs < endMs;
  const used = new Set<Programme>();
  return segments.map(({ from, to, programme }): GuideCell => {
    const repeated = programme !== null && used.has(programme);
    if (programme !== null) used.add(programme);
    return {
      key: programme === null ? `gap-${from}` : `p-${programme.start.getTime()}${repeated ? `-${from}` : ''}`,
      programme,
      state: programme === null ? 'gap' : inside
        ? nowMs < from ? 'future' : nowMs >= to ? 'past' : 'live'
        : stateOf(programme, now),
      weight: (to - from) / 60_000,
      clippedStart: programme !== null && programme.start.getTime() < from,
      clippedEnd: programme !== null && programme.stop.getTime() > to,
    };
  });
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
 * | er slut og helt i arkivet, og kanalen har arkiv | start forfra fra programmets starttidspunkt |
 * | er lige slut (under to minutter) | ingenting, indtil arkivet har de sidste minutter |
 * | er slut, uden arkiv | ingenting |
 * | kommer senere | ingenting |
 *
 * `hasDialect` er om panelets timeshift-dialekt er fundet. Uden den kan der
 * ikke bygges en arkiv-URL, uanset hvad kanalen paastaar om sit arkiv.
 *
 * `nowMs` er guidens nu. "Helt i arkivet" er `archiveComplete` (v425): en
 * udsendelse maerkes foerst som start-forfra naar hele den ligger i arkivet,
 * se forklaringen ved `programmeOptions`.
 */
export function guideAction(
  cell: GuideCell,
  channel: { hasArchive: boolean },
  hasDialect: boolean,
  nowMs: number,
): GuideAction {
  if (cell.programme === null) return 'none';
  if (cell.state === 'live') return 'play';
  if (cell.state === 'past' && channel.hasArchive && hasDialect && archiveComplete(cell.programme, nowMs)) return 'restart';
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
 * som det eneste, med forklaringen.
 *
 * Start forfra tilbydes KUN naar hele udsendelsen ligger i arkivet
 * (`archiveComplete`: slut plus to minutter, v425). Den der sendes lige nu
 * faar altsaa kun "se kanalen". Foer kunne en igangvaerende udsendelse
 * startes forfra: afspilleren hentede saa arkivet i stykker frem til den
 * levende kant og maatte bestille et nyt stykke igen og igen, og hvert
 * stykkeskift froes eller hakkede hos brugeren, i udgave efter udgave
 * (v373-v424). Brugeren bad om at knappen venter til udsendelsen er slut.
 * Naar den er, daekker ét arkivstykke det hele, og der er intet skift at
 * fryse paa. En udsendelse der er slut men endnu ikke helt i arkivet faar
 * ogsaa kun "se kanalen", med bladets forklaring om at det kommer om et
 * oejeblik.
 *
 * `programme` er null paa et hul i programdata; `nowMs` er guidens nu.
 */
export function programmeOptions(
  state: CellState,
  channel: { hasArchive: boolean },
  hasDialect: boolean,
  programme: { stop: Date } | null,
  nowMs: number,
): ProgrammeOptions {
  const archive = channel.hasArchive && hasDialect;
  // Kun det der er slut OG helt gemt kan startes forfra: hverken fremtiden,
  // det der sendes nu, eller det der sluttede for et oejeblik siden.
  const restart = archive && programme !== null && archiveComplete(programme, nowMs);
  if (state === 'past' && restart) return { play: false, restart: true };
  return { play: true, restart };
}

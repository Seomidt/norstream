import type { Programme } from '@norstream/core';

/**
 * Det der staar ved siden af previewet: hvad kanalen sender nu, og hvad
 * der kommer bagefter. Rent regnestykke, saa det kan proeves uden skaerm.
 */
export interface NowNext {
  now: Programme | null;
  next: Programme | null;
}

/**
 * Udsendelsen der er i gang, og den foerste der begynder efter den.
 *
 * "Naeste" er den foerste efter nu naar der ikke er noget i gang — i et hul
 * i programdata skal boksen stadig kunne sige hvornaar der kommer noget.
 */
export function nowAndNext(programmes: readonly Programme[], now: Date): NowNext {
  const ms = now.getTime();
  const sorted = [...programmes].sort((a, b) => a.start.getTime() - b.start.getTime());
  const current = sorted.find((p) => p.start.getTime() <= ms && p.stop.getTime() > ms) ?? null;
  const after = current === null ? ms : current.stop.getTime() - 1;
  const next = sorted.find((p) => p.start.getTime() > after && p !== current) ?? null;
  return { now: current, next };
}

/** Hvor langt udsendelsen er naaet, 0 til 1. Uden for udsendelsen: 0 foer, 1 efter. */
/** De naeste udsendelser efter den der sendes nu (eller efter nu), i raekkefoelge. */
export function upcoming(programmes: readonly Programme[], now: Date, count = 2): Programme[] {
  const { now: current } = nowAndNext(programmes, now);
  const after = current === null ? now.getTime() : current.stop.getTime() - 1;
  return [...programmes]
    .filter((p) => p !== current && p.start.getTime() > after)
    .sort((a, b) => a.start.getTime() - b.start.getTime())
    .slice(0, count);
}

/** Hele minutter til udsendelsen slutter; 0 naar den er slut. */
export function minutesLeft(programme: Programme, now: Date): number {
  return Math.max(0, Math.ceil((programme.stop.getTime() - now.getTime()) / 60_000));
}

export function progressRatio(programme: Programme, now: Date): number {
  const start = programme.start.getTime();
  const stop = programme.stop.getTime();
  if (stop <= start) return 1;
  const ratio = (now.getTime() - start) / (stop - start);
  return Math.min(1, Math.max(0, ratio));
}

/**
 * Fra hvilken bredde previewet laegger sig til venstre med boksen til hoejre.
 *
 * En telefon paa hoejkant er 360–430 punkter; en foldet skaerm slaaet ud,
 * en tablet, en telefon paa siden og et tv er alle bredere. Under graensen
 * ville to spalter blive for smalle til at nogen af dem kunne laeses.
 */
export const SIDE_BY_SIDE_MIN_WIDTH = 700;

/** Previewets andel af bredden naar det staar til venstre. Resten er boksen. */
export const SIDE_PREVIEW_FRACTION = 0.42;

/**
 * Previewets andel paa tv: mindre end paa en tablet, for hoejden er det
 * knappe. Med 42 % af 780 punkter var previewet 184 punkter hoejt, og
 * guiden fik én raekke tilbage. Med 30 % faar den fem.
 */
export const TV_SIDE_PREVIEW_FRACTION = 0.3;

export function sidePreviewFraction(tv: boolean): number {
  return tv ? TV_SIDE_PREVIEW_FRACTION : SIDE_PREVIEW_FRACTION;
}

export type GuideTopLayout = 'stacked' | 'side';

export function guideTopLayout(width: number): GuideTopLayout {
  return width >= SIDE_BY_SIDE_MIN_WIDTH ? 'side' : 'stacked';
}

const pad = (n: number): string => String(n).padStart(2, '0');

export function formatClock(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** "18:30–18:50", som i gitteret. */
export function formatSpan(programme: Programme): string {
  return `${formatClock(programme.start)}–${formatClock(programme.stop)}`;
}

const WEEKDAYS = ['søn', 'man', 'tir', 'ons', 'tor', 'fre', 'lør'];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];

function startOfDay(d: Date): number {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.getTime();
}

/**
 * Hvilken dag en udsendelse ligger paa, i forhold til nu — eller null naar det
 * er i dag. Saa kan boksen sige "i går" ud over klokkeslaettet, naar man har
 * bladret tilbage i tiden i guiden ("hvornaar det er sendt, men ogsaa hvad dag").
 */
export function dayContext(date: Date, now: Date): string | null {
  const diff = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);
  if (diff === 0) return null;
  if (diff === 1) return 'i går';
  if (diff === -1) return 'i morgen';
  return `${WEEKDAYS[date.getDay()]} ${date.getDate()}. ${MONTHS[date.getMonth()]}`;
}

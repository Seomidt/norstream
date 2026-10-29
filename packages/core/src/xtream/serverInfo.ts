import { toInteger } from './coerce.js';

/** `"2026-09-05 18:34:12"` — panelets lokale tid, uden zoneangivelse. */
const LOCAL_TIME = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/;

/** Tidszone-offsets er altid hele kvarter. Afrundingen absorberer svartid. */
const QUARTER_MINUTES = 15;
/** Yderpunkterne i verdens tidszoner er UTC-12 og UTC+14. */
const MAX_OFFSET_MINUTES = 14 * 60;

interface RawServerInfo {
  server_info?: {
    time_now?: string;
    timestamp_now?: string | number;
    timezone?: unknown;
  };
}

/** Panelets maalte ur, med en valideret zone naar runtime kan laese den. */
export interface PanelClock {
  offsetMinutes: number;
  timeZone?: string;
}

/** Intl kan mangle zonedata paa en boks. Et fejlende eller skaevt svar bruges aldrig. */
function offsetInZone(timeZone: string, date: Date): number | null {
  const epochMs = date.getTime();
  if (!Number.isFinite(epochMs)) return null;
  try {
    const formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone, calendar: 'gregory', numberingSystem: 'latn', hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    const parts = formatter.formatToParts(date);
    const read = (type: Intl.DateTimeFormatPartTypes): number => Number(parts.find((part) => part.type === type)?.value);
    const year = read('year');
    const month = read('month');
    const day = read('day');
    const hour = read('hour');
    const minute = read('minute');
    const second = read('second');
    if (![year, month, day, hour, minute, second].every(Number.isInteger)
      || month < 1 || month > 12 || day < 1 || day > 31
      || hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) return null;
    const wallMs = Date.UTC(year, month - 1, day, hour, minute, second);
    const offset = (wallMs - Math.floor(epochMs / 1000) * 1000) / 60_000;
    return Number.isInteger(offset) && Math.abs(offset) <= MAX_OFFSET_MINUTES ? offset : null;
  } catch {
    return null;
  }
}

/**
 * Udleder panelets offset fra UTC i minutter ud af `server_info`.
 *
 * Metoden er `time_now` — panelets ur i dets egen zone — minus `timestamp_now`,
 * som er det samme oejeblik i epoch-sekunder. Forskellen *er* offsettet.
 *
 * `server_info.timezone` kan vaere forkert eller ikke kunne laeses af boksen.
 * Den maalte forskel har derfor altid forrang. `panelClockFromServerInfo`
 * accepterer kun en zone der stemmer med netop denne maaling.
 *
 * Returnerer `null` hvis et af felterne mangler eller er uforstaaeligt. Appen
 * beholder da sit gemte offset; `detectTimeshiftDialect` prober i forvejen
 * 13 timer tilbage, saa et forkert offset slaar ikke start-forfra fra.
 */
export function panelOffsetFromServerInfo(raw: unknown): number | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const info = (raw as RawServerInfo).server_info;
  if (typeof info !== 'object' || info === null) return null;

  const local = typeof info.time_now === 'string' ? LOCAL_TIME.exec(info.time_now.trim()) : null;
  const epochSeconds = toInteger(info.timestamp_now);
  if (local === null || epochSeconds === null || epochSeconds <= 0) return null;

  const [, y, mo, d, h, mi, s] = local;
  const month = Number(mo);
  const day = Number(d);
  const hour = Number(h);
  const minute = Number(mi);
  const second = s === undefined ? 0 : Number(s);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;

  // Panelets ur laest som om det var UTC. Differencen til det rigtige
  // oejeblik er praecis den forskydning zonen laegger oveni.
  const asIfUtcMs = Date.UTC(Number(y), month - 1, day, hour, minute, second);
  const roundtrip = new Date(asIfUtcMs);
  if (roundtrip.getUTCMonth() !== month - 1 || roundtrip.getUTCDate() !== day) return null;

  const rawMinutes = (asIfUtcMs - epochSeconds * 1000) / 60_000;
  if (!Number.isFinite(rawMinutes)) return null;

  const rounded = Math.round(rawMinutes / QUARTER_MINUTES) * QUARTER_MINUTES;
  if (Math.abs(rounded) > MAX_OFFSET_MINUTES) return null;
  return rounded;
}

/** En zone alene beviser ikke panelets ur; maaling og zone skal stemme overens. */
export function panelClockFromServerInfo(raw: unknown): PanelClock | null {
  const offsetMinutes = panelOffsetFromServerInfo(raw);
  if (offsetMinutes === null) return null;
  const fixed: PanelClock = { offsetMinutes };
  const info = (raw as RawServerInfo).server_info;
  const timeZone = typeof info?.timezone === 'string' ? info.timezone.trim() : '';
  const epochSeconds = toInteger(info?.timestamp_now);
  if (timeZone.length === 0 || timeZone.length > 100 || epochSeconds === null) return fixed;
  if (offsetInZone(timeZone, new Date(epochSeconds * 1000)) !== offsetMinutes) return fixed;
  return { offsetMinutes, timeZone };
}

/** Arkivets dato bestemmer sommer-/vintertid; nutidens offset er kun reserve. */
export function panelOffsetForDate(clock: PanelClock, date: Date): number {
  if (clock.timeZone === undefined) return clock.offsetMinutes;
  return offsetInZone(clock.timeZone, date) ?? clock.offsetMinutes;
}

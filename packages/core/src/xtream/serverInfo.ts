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
  };
}

/**
 * Udleder panelets offset fra UTC i minutter ud af `server_info`.
 *
 * Metoden er `time_now` — panelets ur i dets egen zone — minus `timestamp_now`,
 * som er det samme oejeblik i epoch-sekunder. Forskellen *er* offsettet.
 *
 * `server_info.timezone` (maalt: `Europe/Amsterdam`) fortolkes bevidst **ikke**.
 * At omsaette et IANA-zonenavn til et offset kraever `Intl` med vilkaarlig zone,
 * og Hermes leverer ikke det paalideligt paa Android. To felter der allerede er
 * i svaret giver det samme svar med ren aritmetik.
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

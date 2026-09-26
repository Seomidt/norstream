/**
 * Vejr til guiden — rene funktioner uden IO.
 *
 * Appen henter positionen (ud fra boksens IP) og vejret (open-meteo) og lader
 * disse oversaette svarene. At holde parsning og tekst her betyder at de kan
 * testes uden netvaerk, og at `packages/app` kun staar for selve hentningen.
 *
 * Vejrkoderne er WMO's (open-meteos `weather_code`).
 */

export type WeatherIcon = 'sun' | 'cloud' | 'rain' | 'snow' | 'fog' | 'storm';

/** Én position, som en IP-opslagstjeneste giver den. */
export interface GeoLocation {
  lat: number;
  lon: number;
  city: string | null;
}

/** Vejret lige nu plus dagens yderpunkter. */
export interface WeatherNow {
  tempNow: number;
  tempMax: number | null;
  tempMin: number | null;
  code: number;
}

/** Et tal der faktisk er et endeligt tal (ikke NaN/uendeligt/streng-fejl). */
function finiteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

/**
 * Oversaetter et IP-positionssvar (fx ipwho.is) til en position.
 *
 * Kraever gyldige koordinater; ellers null, saa appen bare lader vaere med at
 * vise vejr frem for at vise noget forkert. Byen er valgfri pynt.
 */
export function parseGeoLocation(raw: unknown): GeoLocation | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const obj = raw as Record<string, unknown>;
  // ipwho.is melder success:false ved fejl; respektér det.
  if (obj.success === false) return null;
  const lat = finiteNumber(obj.latitude);
  const lon = finiteNumber(obj.longitude);
  if (lat === null || lon === null) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  const city = typeof obj.city === 'string' && obj.city.trim().length > 0 ? obj.city.trim() : null;
  return { lat, lon, city };
}

/**
 * Oversaetter open-meteos svar til vejret nu og dagens yderpunkter.
 *
 * Bygget paa et kald som:
 *   current=temperature_2m,weather_code
 *   daily=temperature_2m_max,temperature_2m_min
 * Mangler nu-temperaturen, er der intet at vise (null). Yderpunkterne er
 * valgfrie: uden dem vises kun nu-graderne.
 */
export function parseOpenMeteo(raw: unknown): WeatherNow | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const obj = raw as Record<string, unknown>;
  const current = obj.current;
  if (typeof current !== 'object' || current === null) return null;
  const cur = current as Record<string, unknown>;
  const tempNow = finiteNumber(cur.temperature_2m);
  if (tempNow === null) return null;
  const code = finiteNumber(cur.weather_code) ?? 0;

  let tempMax: number | null = null;
  let tempMin: number | null = null;
  const daily = obj.daily;
  if (typeof daily === 'object' && daily !== null) {
    const d = daily as Record<string, unknown>;
    if (Array.isArray(d.temperature_2m_max)) tempMax = finiteNumber(d.temperature_2m_max[0]);
    if (Array.isArray(d.temperature_2m_min)) tempMin = finiteNumber(d.temperature_2m_min[0]);
  }

  return { tempNow, tempMax, tempMin, code: Math.trunc(code) };
}

/** Dansk tekst for en WMO-vejrkode. Ukendte koder bliver til "Vejr". */
export function weatherText(code: number): string {
  switch (code) {
    case 0:
      return 'Klart';
    case 1:
      return 'Overvejende klart';
    case 2:
      return 'Delvist skyet';
    case 3:
      return 'Overskyet';
    case 45:
    case 48:
      return 'Tåge';
    case 51:
    case 53:
    case 55:
      return 'Finregn';
    case 56:
    case 57:
      return 'Isslag';
    case 61:
      return 'Let regn';
    case 63:
      return 'Regn';
    case 65:
      return 'Kraftig regn';
    case 66:
    case 67:
      return 'Isregn';
    case 71:
      return 'Let sne';
    case 73:
      return 'Sne';
    case 75:
      return 'Kraftig sne';
    case 77:
      return 'Snefnug';
    case 80:
    case 81:
      return 'Regnbyger';
    case 82:
      return 'Kraftige byger';
    case 85:
    case 86:
      return 'Snebyger';
    case 95:
      return 'Tordenvejr';
    case 96:
    case 99:
      return 'Torden med hagl';
    default:
      return 'Vejr';
  }
}

/** Kategori-ikon for en WMO-vejrkode. */
export function weatherIcon(code: number): WeatherIcon {
  if (code === 0 || code === 1) return 'sun';
  if (code === 45 || code === 48) return 'fog';
  if (code >= 95) return 'storm';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
  return 'cloud';
}

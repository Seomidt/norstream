/**
 * Solopgang og solnedgang, regnet ud lokalt.
 *
 * NOAA's formel (som i deres solar calculator), god til et par minutter,
 * og det er rigeligt: temaet skifter naar solen gaar ned, ikke paa
 * sekundet. Ingen netvaerk og ingen placeringstilladelse: stedet vaelges
 * under Indstillinger, og for Danmark er forskellen mellem byerne under
 * et kvarter.
 *
 * Nord for polarcirklen om sommeren/vinteren gaar solen ikke op eller ned;
 * saa regnes dagen for lys hhv. moerk hele doegnet.
 */

export interface SunTimes {
  /** Millisekunder siden epoken, eller null naar solen ikke staar op/gaar ned den dag. */
  sunriseMs: number | null;
  sunsetMs: number | null;
  /** Sand hvis solen aldrig gaar ned (midnatssol), falsk hvis den aldrig staar op. Kun naar begge er null. */
  polarDay: boolean;
}

const DEG = Math.PI / 180;
const ZENITH = 90.833; // Officiel solopgang: solens overkant i horisonten, med brydning.

function toRad(degrees: number): number {
  return degrees * DEG;
}

function toDeg(radians: number): number {
  return radians / DEG;
}

/** Dagen (lokal dato for stedet regnes ud fra UTC-datoen, som er godt nok ved vores laengdegrader). */
function julianDay(date: Date): number {
  return date.getTime() / 86_400_000 - 0.5 + 2_440_587.5;
}

/**
 * Solopgang og -nedgang paa den dag `date` ligger i (UTC-dato), paa stedet.
 * Returnerer tidspunkterne som millisekunder siden epoken.
 */
export function sunTimes(date: Date, latitude: number, longitude: number): SunTimes {
  const dayStart = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const jd = julianDay(new Date(dayStart)) + 0.5 - longitude / 360; // omkring lokal middag
  const t = (jd - 2_451_545) / 36_525;
  const meanLong = (280.46646 + t * (36_000.76983 + t * 0.0003032)) % 360;
  const meanAnom = 357.52911 + t * (35_999.05029 - 0.0001537 * t);
  const eccent = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const eqCenter =
    Math.sin(toRad(meanAnom)) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
    Math.sin(toRad(2 * meanAnom)) * (0.019993 - 0.000101 * t) +
    Math.sin(toRad(3 * meanAnom)) * 0.000289;
  const trueLong = meanLong + eqCenter;
  const omega = 125.04 - 1934.136 * t;
  const apparentLong = trueLong - 0.00569 - 0.00478 * Math.sin(toRad(omega));
  const obliqMean = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const obliq = obliqMean + 0.00256 * Math.cos(toRad(omega));
  const declination = toDeg(Math.asin(Math.sin(toRad(obliq)) * Math.sin(toRad(apparentLong))));
  const y = Math.tan(toRad(obliq / 2)) ** 2;
  const eqTime =
    4 *
    toDeg(
      y * Math.sin(2 * toRad(meanLong)) -
        2 * eccent * Math.sin(toRad(meanAnom)) +
        4 * eccent * y * Math.sin(toRad(meanAnom)) * Math.cos(2 * toRad(meanLong)) -
        0.5 * y * y * Math.sin(4 * toRad(meanLong)) -
        1.25 * eccent * eccent * Math.sin(2 * toRad(meanAnom)),
    );
  const cosHa =
    Math.cos(toRad(ZENITH)) / (Math.cos(toRad(latitude)) * Math.cos(toRad(declination))) -
    Math.tan(toRad(latitude)) * Math.tan(toRad(declination));
  if (cosHa > 1) return { sunriseMs: null, sunsetMs: null, polarDay: false };
  if (cosHa < -1) return { sunriseMs: null, sunsetMs: null, polarDay: true };
  const hourAngle = toDeg(Math.acos(cosHa));
  const solarNoonMinutes = 720 - 4 * longitude - eqTime; // minutter efter midnat UTC
  const sunriseMinutes = solarNoonMinutes - 4 * hourAngle;
  const sunsetMinutes = solarNoonMinutes + 4 * hourAngle;
  return {
    sunriseMs: dayStart + sunriseMinutes * 60_000,
    sunsetMs: dayStart + sunsetMinutes * 60_000,
    polarDay: false,
  };
}

/** Er det lyst paa stedet lige nu? */
export function isDaylight(now: Date, latitude: number, longitude: number): boolean {
  const times = sunTimes(now, latitude, longitude);
  if (times.sunriseMs === null || times.sunsetMs === null) return times.polarDay;
  const ms = now.getTime();
  return ms >= times.sunriseMs && ms < times.sunsetMs;
}

/** Naar temaet naeste gang skal skifte: den naeste solopgang eller -nedgang efter `now`. */
export function nextSunChangeMs(now: Date, latitude: number, longitude: number): number {
  const ms = now.getTime();
  for (let day = 0; day < 3; day += 1) {
    const times = sunTimes(new Date(ms + day * 86_400_000), latitude, longitude);
    if (times.sunriseMs !== null && times.sunriseMs > ms) return times.sunriseMs;
    if (times.sunsetMs !== null && times.sunsetMs > ms) return times.sunsetMs;
  }
  // Polarnat/midnatssol: kig igen om et doegn.
  return ms + 86_400_000;
}

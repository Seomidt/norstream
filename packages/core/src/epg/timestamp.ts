const PATTERN = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?\s*([+-]\d{4})?$/;

/**
 * Parser et XMLTV-tidsstempel, fx "20260904200000 +0200".
 * Mangler offset, fortolkes tidspunktet som UTC.
 * Returnerer null hvis strengen ikke er et gyldigt tidsstempel.
 */
export function parseXmltvTimestamp(value: string): Date | null {
  const match = PATTERN.exec(value.trim());
  if (!match) return null;

  const [, y, mo, d, h, mi, s, offset] = match;
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  const hour = Number(h);
  const minute = Number(mi);
  const second = s === undefined ? 0 : Number(s);

  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;

  let ms = Date.UTC(year, month - 1, day, hour, minute, second);

  // Afvis datoer der ruller over, fx 31. februar.
  const roundtrip = new Date(ms);
  if (roundtrip.getUTCMonth() !== month - 1 || roundtrip.getUTCDate() !== day) {
    return null;
  }

  if (offset) {
    const sign = offset.startsWith('-') ? -1 : 1;
    const offsetHours = Number(offset.slice(1, 3));
    const offsetMinutes = Number(offset.slice(3, 5));
    ms -= sign * (offsetHours * 60 + offsetMinutes) * 60_000;
  }

  return new Date(ms);
}

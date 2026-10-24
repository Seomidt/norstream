/**
 * Base64-afkodning til UTF-8-tekst, skrevet i ren TypeScript.
 *
 * Hvorfor ikke `atob`: den findes ikke i `lib: ["ES2022"]`, som core bevidst er
 * begraenset til, og den returnerer latin1-bytes. En dansk programtitel med
 * `aeoeaa` ville komme ud som mojibake. `TextDecoder` ville lukke det hul, men
 * ligger i DOM-lib'en, som core lige saa bevidst ikke traekker ind.
 *
 * Som al anden parsing i core kaster den aldrig: ugyldigt input giver `null`.
 */

/** Sentinelvaerdi i opslagstabellen for tegn der ikke hoerer til alfabetet. */
const INVALID = -1;

/**
 * Opslagstabel for base64-alfabetet, inklusive URL-varianten (`-` og `_`).
 * Panelet bruger standard-alfabetet, men URL-varianten koster kun to poster og
 * fjerner en mulig stille fejlkilde.
 */
const LOOKUP: readonly number[] = (() => {
  const table = new Array<number>(128).fill(INVALID);
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  for (let i = 0; i < alphabet.length; i += 1) {
    table[alphabet.charCodeAt(i)] = i;
  }
  table['-'.charCodeAt(0)] = 62;
  table['_'.charCodeAt(0)] = 63;
  return table;
})();

function isWhitespace(code: number): boolean {
  return code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d;
}

/**
 * Base64 til raa bytes. Whitespace ignoreres, padding er valgfri, og enhver
 * anden afvigelse giver `null` frem for et gaet.
 */
function decodeBase64Bytes(value: string): number[] | null {
  const bytes: number[] = [];
  let accumulator = 0;
  let bits = 0;
  let seenPadding = false;

  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (isWhitespace(code)) continue;

    if (code === 0x3d) {
      // '=' maa kun staa til sidst; alt efter det er ugyldigt.
      seenPadding = true;
      continue;
    }
    if (seenPadding) return null;

    const digit = code < 128 ? (LOOKUP[code] ?? INVALID) : INVALID;
    if (digit === INVALID) return null;

    accumulator = (accumulator << 6) | digit;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((accumulator >> bits) & 0xff);
    }
  }

  // Et enkelt tilbagevaerende base64-ciffer koder ingen hel byte og kan kun
  // opstaa af beskadiget input.
  if (bits >= 6) return null;
  // Ubrugte bits skal vaere nul i korrekt kodet base64.
  if (bits > 0 && (accumulator & ((1 << bits) - 1)) !== 0) return null;

  return bytes;
}

/** Samler kodeenheder i portioner, saa et langt afsnit ikke sprænger kaldstakken. */
const CHUNK = 4096;

function fromCodeUnits(units: number[]): string {
  let out = '';
  for (let i = 0; i < units.length; i += CHUNK) {
    out += String.fromCharCode(...units.slice(i, i + CHUNK));
  }
  return out;
}

/**
 * UTF-8-bytes til tekst med fuld validering: overlange sekvenser, loese
 * surrogater og afkortede sekvenser afvises alle med `null` frem for at blive
 * til et erstatningstegn. En titel vi ikke kan laese korrekt er bedre udeladt
 * end vist forkert.
 */
function decodeUtf8(bytes: number[]): string | null {
  const units: number[] = [];

  for (let i = 0; i < bytes.length; ) {
    const first = bytes[i] as number;
    let codePoint: number;
    let length: number;

    if (first < 0x80) {
      codePoint = first;
      length = 1;
    } else if (first >= 0xc2 && first <= 0xdf) {
      codePoint = first & 0x1f;
      length = 2;
    } else if (first >= 0xe0 && first <= 0xef) {
      codePoint = first & 0x0f;
      length = 3;
    } else if (first >= 0xf0 && first <= 0xf4) {
      codePoint = first & 0x07;
      length = 4;
    } else {
      // 0x80-0xC1 og 0xF5-0xFF starter aldrig en gyldig sekvens.
      return null;
    }

    if (i + length > bytes.length) return null;

    for (let k = 1; k < length; k += 1) {
      const next = bytes[i + k] as number;
      if ((next & 0xc0) !== 0x80) return null;
      codePoint = (codePoint << 6) | (next & 0x3f);
    }

    // Overlange sekvenser og surrogater har samme kodepunkt som en kortere
    // eller ugyldig kodning og skal afvises her, ikke stiltiende accepteres.
    if (length === 3 && codePoint < 0x800) return null;
    if (length === 4 && codePoint < 0x10000) return null;
    if (codePoint >= 0xd800 && codePoint <= 0xdfff) return null;
    if (codePoint > 0x10ffff) return null;

    if (codePoint > 0xffff) {
      const offset = codePoint - 0x10000;
      units.push(0xd800 + (offset >> 10), 0xdc00 + (offset & 0x3ff));
    } else {
      units.push(codePoint);
    }

    i += length;
  }

  return fromCodeUnits(units);
}

/**
 * Afkoder en base64-kodet UTF-8-streng. Returnerer `null` hvis strengen ikke er
 * gyldig base64, eller hvis de afkodede bytes ikke er gyldig UTF-8.
 * En tom streng afkoder til en tom streng, ikke til `null`.
 */
export function decodeBase64Utf8(value: string): string | null {
  const bytes = decodeBase64Bytes(value);
  if (bytes === null) return null;
  return decodeUtf8(bytes);
}

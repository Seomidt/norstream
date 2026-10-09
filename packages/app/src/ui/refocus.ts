/**
 * Hvor fjernbetjeningen var, da man trykkede OK.
 *
 * Naar afspilleren eller et ark lukker, forsvinder det trykpunkt der havde
 * fokus, og Android giver fokus til det foerste trykpunkt paa skaermen —
 * oppe i toppen. Derfor husker TvPressable de sidste tryk, og skaermen
 * beder om at faa fokus tilbage paa det seneste af dem der stadig findes:
 * kortet, raekken eller cellen man aabnede fra.
 */
interface Entry {
  id: number;
  fire: () => void;
}

const MAX = 8;
const recent: Entry[] = [];
let nextId = 0;

export function registerPressable(fire: () => void): Entry {
  return { id: nextId++, fire };
}

/** Kaldes ved tryk: entryen bliver den seneste. */
export function notePressed(entry: Entry): void {
  const index = recent.indexOf(entry);
  if (index !== -1) recent.splice(index, 1);
  recent.push(entry);
  while (recent.length > MAX) recent.shift();
}

export function forgetPressable(entry: Entry): void {
  const index = recent.indexOf(entry);
  if (index !== -1) recent.splice(index, 1);
}

/** Fokus tilbage paa det seneste tryk der stadig er paa skaermen. Sandt naar der var et. */
export function refocusLastPressed(): boolean {
  const entry = recent[recent.length - 1];
  if (entry === undefined) return false;
  entry.fire();
  return true;
}

/** Til tests. */
export function clearPressed(): void {
  recent.length = 0;
}

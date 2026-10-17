/**
 * Op til to bogstaver fra et kanalnavn, til brug hvor et logo mangler.
 *
 * Ligger i sit eget modul frem for i komponenten, saa den kan testes: alt der
 * importerer react-native kan ikke koeres af testene her.
 *
 * Landepraefikser som `DNK|` springes over. De er ens for hele listen og siger
 * intet om hvilken kanal man kigger paa — to kanaler ville faa samme maerke.
 */
export function initials(name: string): string {
  const words = bareName(name)
    .split(/\s+/)
    .filter((word) => word.length > 0);
  if (words.length === 0) return '?';
  const first = words[0] ?? '';
  const second = words[1] ?? '';
  const letters = (first.slice(0, 1) + second.slice(0, 1)).toUpperCase();
  return letters.length > 0 ? letters : '?';
}

/** Ord der ikke er en del af navnet. Kun 'radio': `DR1 HD` skal stadig give DH, som det altid har. */
const NOISE = new Set(['RADIO']);

/**
 * Navnet uden panelets pynt: `SWE| [Radio][SE] Bandit Metal HD` -> `Bandit Metal`.
 * Praefikset foer den lodrette streg, landekoden med kolon, alt i klammer og
 * parenteser, og kvalitetsordene. Det er det navn initialerne skal komme fra;
 * foer blev det `[B`.
 */
export function bareName(name: string): string {
  let text = name.includes('|') ? name.slice(name.lastIndexOf('|') + 1) : name;
  text = text.replace(/^\s*[A-Za-z]{2,3}\s*:\s*/, '');
  text = text.replace(/\[[^\]]*\]|\([^)]*\)/g, ' ');
  const words = text.split(/\s+/).filter((word) => word.length > 0 && !NOISE.has(word.toUpperCase()));
  return words.join(' ').trim();
}

/**
 * En farve til kanalen naar der intet logo er, udledt af navnet, saa den
 * samme kanal altid har den samme farve og to naboer sjaeldent den samme.
 * Daempet og moerk nok til hvid skrift.
 */
export function tileColour(name: string): string {
  const key = bareName(name).toLowerCase();
  let hash = 0;
  for (let index = 0; index < key.length; index += 1) hash = (hash * 31 + key.charCodeAt(index)) >>> 0;
  const hue = hash % 360;
  return `hsl(${hue}, 45%, 38%)`;
}

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
  const cleaned = name.replace(/^[A-Za-z]{2,3}\s*[|:]\s*/, '').trim();
  const words = cleaned.split(/\s+/).filter((word) => word.length > 0);
  if (words.length === 0) return '?';
  const first = words[0] ?? '';
  const second = words[1] ?? '';
  const letters = (first.slice(0, 1) + second.slice(0, 1)).toUpperCase();
  return letters.length > 0 ? letters : '?';
}

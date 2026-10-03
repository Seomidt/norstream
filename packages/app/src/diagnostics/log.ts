/**
 * En lille log i hukommelsen (v349), til fejlsoegning fra sofaen.
 *
 * Fejl som "start forfra fryser efter et minut" kan ikke ses herfra, og
 * adb er ikke altid ved haanden. Afspilleren og guiden skriver derfor korte
 * linjer her — hvad de bad om, hvad afspilleren svarede, hvad de besluttede
 * — og Indstillinger → Fejlfinding viser de sidste linjer, saa et
 * skaermbillede fortaeller hvad der skete. Adresser (med panelets kodeord)
 * skrives aldrig; kun form, tidspunkt og laengde.
 */
const MAX_LINES = 300;
const lines: string[] = [];
const listeners = new Set<() => void>();

function stamp(): string {
  const d = new Date();
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** Skriver en linje. `text` maa ikke rumme adresser; `safe` fjerner dem for en sikkerheds skyld. */
export function logEvent(tag: string, text: string): void {
  lines.push(`${stamp()} ${tag}: ${safe(text)}`);
  if (lines.length > MAX_LINES) lines.splice(0, lines.length - MAX_LINES);
  for (const listener of listeners) listener();
}

export function safe(text: string): string {
  return text.replace(/https?:\/\/\S+/g, '[adresse]').replace(/password=[^&\s]+/gi, 'password=…');
}

/** De sidste linjer, nyeste nederst. */
export function recentLog(count = 60): string[] {
  return lines.slice(-count);
}

export function clearLog(): void {
  lines.length = 0;
  for (const listener of listeners) listener();
}

export function onLog(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Klokkeslaet for et tidspunkt, til logtekster. */
export function clockOf(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

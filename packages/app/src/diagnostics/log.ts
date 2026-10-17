/**
 * En lille visningslog. journal.ts gemmer en begraenset kopi paa disken.
 *
 * Fejl som "start forfra fryser efter et minut" kan ikke ses herfra, og
 * adb er ikke altid ved haanden. Afspilleren og guiden skriver derfor korte
 * linjer her — hvad de bad om, hvad afspilleren svarede, hvad de besluttede
 * — og Indstillinger viser de sidste linjer. Tidsbegraenset upload
 * starter automatisk efter denne opdatering og kan slaas fra. Adresser (med panelets kodeord)
 * skrives aldrig; kun form, tidspunkt og laengde.
 */
const MAX_LINES = 300;
const lines: string[] = [];
const entries: { at: number; line: string }[] = [];
const entryListeners = new Set<(entry: { at: number; line: string }) => void>();
const listeners = new Set<() => void>();

function stamp(): string {
  const d = new Date();
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** Skriver en linje. `text` maa ikke rumme adresser; `safe` fjerner dem for en sikkerheds skyld. */
export function logEvent(tag: string, text: string): void {
  const entry = { at: Date.now(), line: `${stamp()} ${safe(tag)}: ${safe(text)}`.slice(0, 300) };
  lines.push(entry.line);
  entries.push(entry);
  if (entries.length > MAX_LINES) entries.splice(0, entries.length - MAX_LINES);
  for (const listener of entryListeners) { try { listener(entry); } catch { /* Fejlfinding maa aldrig vaelte afspilleren. */ } }
  if (lines.length > MAX_LINES) lines.splice(0, lines.length - MAX_LINES);
  for (const listener of listeners) listener();
}

export function safe(text: string): string {
  return text.replace(/(\btrailer:\s*TV:).+?(,\s*direkte HD)/gi, '$1 [titel]$2').replace(/[a-z][a-z0-9+.-]*:\/\/\S+/gi, '[adresse]')
    .replace(/\b(username|password|token|apikey|api_key|authorization)\s*[=:]\s*[^&\s,;]+/gi, '$1=…')
    .replace(/\bBearer\s+\S+/gi, 'Bearer …');
}

/** De sidste linjer, nyeste nederst. */
export function recentLog(count = 60): string[] {
  return lines.slice(-count);
}

export function clearLog(): void {
  lines.length = 0;
  entries.length = 0;
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

export function recentEntries(): { at: number; line: string }[] { return entries.map(e => ({ ...e })); }
export function restoreLog(history: { at: number; line: string }[]): void {
  const all = [...history, ...entries].slice(-MAX_LINES).map(e => ({ at: e.at, line: safe(e.line).slice(0, 300) }));
  entries.splice(0, entries.length, ...all);
  lines.splice(0, lines.length, ...all.map(e => safe(e.line).slice(0, 300)));
  for (const listener of listeners) listener();
}
export function onLogEntry(listener: (entry: { at: number; line: string }) => void): () => void {
  entryListeners.add(listener); return () => { entryListeners.delete(listener); };
}

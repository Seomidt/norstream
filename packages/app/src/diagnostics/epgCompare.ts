import type { EpgListingSummary, Programme } from '@norstream/core';

/**
 * Fejlfinding af "i dag viser sidste uges program" (v429), uden titler i
 * loggen: kun tal og klokkeslaet. Titler sammenlignes her i appen.
 */

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** Lokal tid "29.10 19:00". */
export function localStamp(ms: number): string {
  const date = new Date(ms);
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function clockKey(programme: Programme): string {
  const date = new Date(programme.start);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}\u0000${programme.title.trim().toLowerCase()}`;
}

function within(programmes: readonly Programme[], from: number, to: number): Programme[] {
  return programmes.filter(p => p.start.getTime() >= from && p.start.getTime() < to);
}

/** Hvor mange af dagens programmer har samme titel og klokkeslaet som for 7 dage siden? */
export function weekRepeat(programmes: readonly Programme[], todayStartMs: number): { today: number; lastWeek: number; same: number } {
  const today = within(programmes, todayStartMs, todayStartMs + DAY_MS);
  const lastWeek = within(programmes, todayStartMs - WEEK_MS, todayStartMs - WEEK_MS + DAY_MS);
  const keys = new Set(lastWeek.map(clockKey));
  return { today: today.length, lastWeek: lastWeek.length, same: today.filter(p => keys.has(clockKey(p))).length };
}

function currentOf(programmes: readonly Programme[], nowMs: number): Programme | null {
  let found: Programme | null = null;
  for (const p of programmes) {
    if (p.start.getTime() <= nowMs && p.stop.getTime() > nowMs && (found === null || p.start > found.start)) found = p;
  }
  return found;
}

/** Den raa tabel: antal, spaend og dato-tekstens forskel fra tidsstemplet. */
export function describePanelTable(summary: EpgListingSummary): string {
  const span = summary.firstMs === null || summary.lastMs === null ? 'ingen tider'
    : `${localStamp(summary.firstMs)} til ${localStamp(summary.lastMs)}`;
  const offsets = Object.entries(summary.textMinusTimestampHours)
    .sort((a, b) => b[1] - a[1])
    .map(([hours, count]) => `${Number(hours) >= 0 ? '+' : ''}${hours} t (${count})`)
    .join(', ') || 'ingen dato-tekst';
  return `panel-tabel v429: ${summary.count} poster, starter ${span}; dato-tekst minus tidsstempel: ${offsets}`;
}

/** Tabellen omkring nu og sammenlignet med samme dag i sidste uge. */
export function describeTableNow(programmes: readonly Programme[], nowMs: number, todayStartMs: number): string {
  const after = programmes.filter(p => p.start.getTime() > nowMs).length;
  const lastStop = programmes.reduce((max, p) => Math.max(max, p.stop.getTime()), 0);
  const current = currentOf(programmes, nowMs);
  const repeat = weekRepeat(programmes, todayStartMs);
  return `tabel nu v429: ${after} programmer efter nu, sidste slut ${lastStop > 0 ? localStamp(lastStop) : '-'}, `
    + `aktuel ${current === null ? 'ingen' : `${localStamp(current.start.getTime())}-${localStamp(current.stop.getTime()).slice(6)}`}; `
    + `i dag ${repeat.same} af ${repeat.today} med samme titel og klokkeslaet som 7 dage foer (${repeat.lastWeek} den dag)`;
}

/** Panelets nu/naeste (get_short_epg) mod tabellen. */
export function describeShortAgainstTable(short: readonly Programme[], table: readonly Programme[], nowMs: number): string {
  const shortCurrent = currentOf(short, nowMs);
  const tableCurrent = currentOf(table, nowMs);
  const sameTitle = shortCurrent !== null && tableCurrent !== null
    && shortCurrent.title.trim().toLowerCase() === tableCurrent.title.trim().toLowerCase();
  const sameStart = shortCurrent !== null && tableCurrent !== null && shortCurrent.start.getTime() === tableCurrent.start.getTime();
  const lastWeekKeys = new Set(table.filter(p => p.start.getTime() < nowMs - 6 * DAY_MS).map(p => `${p.start.getTime() + WEEK_MS}\u0000${p.title.trim().toLowerCase()}`));
  const asLastWeek = short.filter(p => lastWeekKeys.has(`${p.start.getTime()}\u0000${p.title.trim().toLowerCase()}`)).length;
  const inTable = new Set(table.map(p => `${p.start.getTime()}\u0000${p.title.trim().toLowerCase()}`));
  const shortInTable = short.filter(p => inTable.has(`${p.start.getTime()}\u0000${p.title.trim().toLowerCase()}`)).length;
  const future = short.filter(p => p.start.getTime() > nowMs);
  return `nu/naeste v429: panelet har ${short.length} (${future.length} kommende${future[0] === undefined ? '' : `, foerste ${localStamp(future[0].start.getTime())}`}); `
    + `aktuel ${shortCurrent === null ? 'ingen' : localStamp(shortCurrent.start.getTime())}, samme titel som tabellen ${sameTitle ? 'ja' : 'nej'}, samme start ${sameStart ? 'ja' : 'nej'}; `
    + `${shortInTable} af ${short.length} findes i tabellen; ${asLastWeek} har titel og tid som 7 dage foer`;
}

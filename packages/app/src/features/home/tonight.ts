import type { Programme } from '@norstream/core';

/**
 * Forsidens "I aften" (v340): det favoritkanalerne sender i aften, én
 * udsendelse per kanal, saa man kan planlaegge aftenen og saette
 * paamindelser. Rent regnestykke, testet uden database.
 */

export interface EveningWindow {
  /** Aftenen begynder lidt foer kl. 20, saa "20.00" med lidt forskudt start er med. */
  from: number;
  to: number;
  label: 'I aften' | 'I morgen aften';
}

/** Efter dette klokkeslaet er "i aften" i morgen aften. */
const ROLLOVER_HOUR = 22;
const ROLLOVER_MINUTE = 15;

/** Aftenen 19.45–22.30 i dag; efter 22.15 er det i morgen. */
export function eveningWindow(now: number): EveningWindow {
  const day = new Date(now);
  day.setHours(0, 0, 0, 0);
  const cutoff = new Date(day);
  cutoff.setHours(ROLLOVER_HOUR, ROLLOVER_MINUTE, 0, 0);
  const tomorrow = now >= cutoff.getTime();
  if (tomorrow) day.setDate(day.getDate() + 1);
  const from = new Date(day);
  from.setHours(19, 45, 0, 0);
  const to = new Date(day);
  to.setHours(22, 30, 0, 0);
  return { from: from.getTime(), to: to.getTime(), label: tomorrow ? 'I morgen aften' : 'I aften' };
}

/** Hovedudsendelsen begynder her: 19.55–21.15. */
const PRIME_FROM_MINUTES = 19 * 60 + 55;
const PRIME_TO_MINUTES = 21 * 60 + 15;
/** Kortere udsendelser (vejret, en pause) er ikke aftenens udsendelse. */
const MIN_LENGTH_MS = 15 * 60_000;

function minutesOfDay(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

function startsInPrime(programme: Programme): boolean {
  const minutes = minutesOfDay(programme.start);
  return minutes >= PRIME_FROM_MINUTES && minutes <= PRIME_TO_MINUTES;
}

function length(programme: Programme): number {
  return programme.stop.getTime() - programme.start.getTime();
}

/**
 * Én udsendelse per kanal: den der begynder i den bedste sendetid, ellers
 * den laengste der sendes i loebet af aftenen (en kamp fra 18 taeller).
 * Kanalernes raekkefoelge (favoritternes) bevares; kanaler uden programdata
 * udelades.
 */
export function pickTonight(programmes: readonly Programme[], channelOrder: readonly string[], window: EveningWindow): Programme[] {
  const byChannel = new Map<string, Programme[]>();
  for (const programme of programmes) {
    const list = byChannel.get(programme.channelId);
    if (list === undefined) byChannel.set(programme.channelId, [programme]);
    else list.push(programme);
  }
  const picked: Programme[] = [];
  for (const channelId of channelOrder) {
    const list = byChannel.get(channelId);
    if (list === undefined) continue;
    const candidates = list
      .filter(
        (programme) =>
          length(programme) >= MIN_LENGTH_MS &&
          programme.start.getTime() < window.to &&
          programme.stop.getTime() > window.from + MIN_LENGTH_MS,
      )
      .sort(
        (a, b) =>
          Number(startsInPrime(b)) - Number(startsInPrime(a)) ||
          length(b) - length(a) ||
          a.start.getTime() - b.start.getTime(),
      );
    const best = candidates[0];
    if (best !== undefined) picked.push(best);
  }
  return picked;
}

/** "20.00–21.30" til kortet. */
export function clockRange(programme: Programme): string {
  const clock = (date: Date): string => `${String(date.getHours()).padStart(2, '0')}.${String(date.getMinutes()).padStart(2, '0')}`;
  return `${clock(programme.start)}–${clock(programme.stop)}`;
}

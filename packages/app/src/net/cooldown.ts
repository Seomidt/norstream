import { originOf } from '@norstream/core';
import type { FetchLike } from '@norstream/core';

/**
 * Hvor laenge et panel faar fred efter at have afvist os.
 *
 * Paneler blokerer en adresse et stykke tid naar den spoerger for haardt, og
 * svarer 401 eller 403 imens. Bliver vi ved med at spoerge, forlaenger vi
 * blokeringen. Ti minutter er lidt laengere end de fleste paneler holder
 * den.
 */
export const COOLDOWN_MS = 10 * 60_000;

const until = new Map<string, number>();

export function cooldownUntil(origin: string, now: number = Date.now()): number | null {
  const stamp = until.get(origin);
  if (stamp === undefined) return null;
  if (stamp <= now) {
    until.delete(origin);
    return null;
  }
  return stamp;
}

export function noteRejected(origin: string, now: number = Date.now()): void {
  until.set(origin, now + COOLDOWN_MS);
}

/** Til tests og til udlogning: glem alt. */
export function clearCooldowns(): void {
  until.clear();
}

/** Fejlen der kastes mens et panel har fred. Aldrig en adgangsfejl. */
export class PanelCoolingDownError extends Error {
  constructor(public readonly origin: string, public readonly untilMs: number) {
    super('Panelet afviser lige nu. Appen venter lidt foer den proever igen.');
    this.name = 'PanelCoolingDownError';
  }
}

/**
 * Laegger sig om `fetch` og giver et panel fred naar det afviser.
 *
 * Foer betoed ét 401 eller 403 — ogsaa et midlertidigt, fra et panel der
 * blokerer en adresse der spoerger for haardt — at appen loggede brugeren
 * ud og **slettede kilden, favoritterne og adgangsoplysningerne**. Og saa
 * blev det naeste login afvist af den samme blokering.
 *
 * Nu: svarer en vaert 401/403, faar den ti minutters fred. Imens kastes der
 * her, foer der overhovedet sendes noget, med en fejl der ikke er en
 * adgangsfejl — saa kalderne behandler det som et panel der ikke kan naas,
 * viser det de har, og roerer intet. Adgangsoplysningerne bliver hvor de er.
 * Er kodeordet virkelig skiftet, siger panelet det igen om ti minutter, og
 * saa staar der en knap til at logge ind igen — uden at noget er slettet.
 */
export function withPanelCooldown(fetchImpl: FetchLike): FetchLike {
  return async (url) => {
    const origin = originOf(url);
    if (origin !== null) {
      const stamp = cooldownUntil(origin);
      if (stamp !== null) throw new PanelCoolingDownError(origin, stamp);
    }
    const response = await fetchImpl(url);
    if (origin !== null && (response.status === 401 || response.status === 403)) {
      noteRejected(origin);
    }
    return response;
  };
}

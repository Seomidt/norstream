import type { HomeProvider } from '../storage/settings.js';

/**
 * Tjenestemaerker paa plakaterne (v369): "Netflix" i hjoernet naar TMDB siger
 * titlen ligger dér i Danmark. Kun de tjenester brugeren selv har valgt til
 * forsiden faar et maerke — det er dem der betyder noget, og det er dem vi
 * kender navnet paa uden et opslag. Saettes hvor valget laeses.
 */
const known = new Map<number, string>();

export function setKnownServices(list: readonly HomeProvider[]): void {
  known.clear();
  for (const provider of list) known.set(provider.id, provider.name);
}

/** Navnet paa den foerste valgte tjeneste titlen ligger paa, eller null. */
export function serviceBadgeFor(providerIds: readonly number[]): string | null {
  for (const id of providerIds) {
    const name = known.get(id);
    if (name !== undefined) return shortName(name);
  }
  return null;
}

/** Korte navne, saa maerket ikke daekker plakaten. */
function shortName(name: string): string {
  return name
    .replace(/^Amazon Prime Video$/i, 'Prime')
    .replace(/^Prime Video$/i, 'Prime')
    .replace(/\s+(Plus|\+)$/i, '+')
    .replace(/^Disney Plus$/i, 'Disney+')
    .replace(/^Apple TV Plus$/i, 'Apple TV+')
    .replace(/^HBO Max$/i, 'Max')
    .slice(0, 12);
}

import type { VodLevel } from './VodScreen.js';

/** Samme foraelder til skaermens broedkrumme og fjernbetjeningens Tilbage.
 * Udvalg er et katalog-niveau, ogsaa naar det indeholder serier. */
export function parentVodLevel(level: VodLevel): VodLevel | null {
  switch (level.name) {
    case 'home': return null;
    case 'cinema':
    case 'countries': return { name: 'home' };
    case 'filter':
    case 'categories': return { name: 'countries', kind: level.kind };
    case 'items': return { name: 'categories', kind: level.kind, country: level.country };
  }
}

import { TVEventHandler } from 'react-native';
import { isTV } from './tv.js';

/**
 * Det sidste tryk paa fjernbetjeningen, til at skelne hvordan en liste kom
 * frem.
 *
 * En ny liste giver sin foerste raekke fokus, saa fjernbetjeningen ikke
 * mister det naar den gamle liste forsvinder. Men kun naar listen kom af
 * et tryk paa OK (land -> kategorier): kom den fordi man koerte ned ad
 * menuen og en fane blev valgt, ville den rykke fokus ud af menuen midt i
 * bevaegelsen, og saa "springer det rundt".
 */
let last = { type: '', at: 0 };
let started = false;

export function startTvKeyTracking(): void {
  if (started || !isTV) return;
  started = true;
  TVEventHandler.addListener((event) => {
    if (event.eventType === 'focus' || event.eventType === 'blur') return;
    last = { type: event.eventType, at: Date.now() };
  });
}

/** Sand naar det seneste tryk var OK for hoejst `withinMs` siden. */
export function cameBySelect(withinMs = 2500): boolean {
  if (!isTV) return false;
  return Date.now() - last.at < withinMs && (last.type === 'select' || last.type === 'longSelect');
}

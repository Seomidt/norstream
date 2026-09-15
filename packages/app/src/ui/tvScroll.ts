import type { FlatList } from 'react-native';
import type { ViewStyle } from 'react-native';
import { isTV, useCanvasSize } from './tv.js';

/**
 * Lister paa tv: raekken med fokus holdes midt i listen.
 *
 * Android ruller selv en liste saa den raekke der faar fokus lige akkurat
 * er inde i listens egne kanter. Men listens kanter og det man kan se er
 * ikke altid det samme: laerredet klipper, og saa laa de nederste raekker
 * "inde i listen" men uden for skaermen — "kan ikke komme helt i bunden
 * under kanaler". Midten er altid synlig, og det er ogsaa saadan de andre
 * tv-apper ruller: raekken bliver staaende, listen flytter sig bagved.
 */
export function keepInMiddle<T>(list: FlatList<T> | null, index: number): void {
  if (!isTV || list === null || index < 0) return;
  list.scrollToIndex({ index, viewPosition: 0.5, animated: true });
}

/** Andel af listens hoejde der laegges til nederst, saa den sidste raekke kan naa midten. */
export const TV_TAIL_FRACTION = 0.5;

/**
 * Luft nederst i listen paa tv, saa ogsaa den sidste raekke kan rulles op
 * i midten. Paa telefonen ingen: der ruller man selv, og en halv skaerm
 * tom bund ville se forkert ud.
 */
export function useTvListTail(): ViewStyle | undefined {
  const { height } = useCanvasSize();
  if (!isTV) return undefined;
  return { paddingBottom: Math.round(height * TV_TAIL_FRACTION) };
}

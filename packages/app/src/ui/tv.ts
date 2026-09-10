import { createContext, useContext } from 'react';
import { Platform, useWindowDimensions } from 'react-native';

/**
 * Tv, som i Apple TV og Android TV: skaermen sidder tre meter vaek, og
 * der er ingen fingre, kun en fjernbetjening med fokus.
 *
 * `Platform.isTV` kommer fra tv-udgaven af React Native (react-native-tvos)
 * og er falsk paa telefoner og web.
 */
export const isTV: boolean = Platform.isTV === true;

/**
 * Hele appen tegnes paa et mindre laerred og skaleres op til skaermen.
 * Saa er skrift, logoer og afstande stoerre end paa en telefon uden at
 * hver eneste stil skal aendres, og laesbar fra sofaen.
 *
 * 1,2 og ikke 1,5: med 1,5 blev laerredet kun 324 punkter hoejt paa en
 * 1080p-skaerm, og guiden med preview, dagsknapper og tidslinje fik ingen
 * plads til selve gitteret. Med 1,2 er laerredet 720 x 405 punkter, og
 * skriften er stadig halvanden gang Googles mindstemaal for tv.
 */
export const TV_SCALE = 1.2;

/**
 * Fri kant hele vejen rundt paa tv, som andel af skaermen.
 *
 * Mange fjernsyn beskaerer HDMI-billedet et par procent (overscan), saa
 * det yderste forsvinder: menulinjen nederst laa under skaermens kant paa
 * et Bang & Olufsen. Google anbefaler 5 % fri kant til tv-apps af netop
 * den grund.
 */
export const TV_SAFE_MARGIN = 0.05;

export interface CanvasSize {
  width: number;
  height: number;
}

/**
 * Det laerred appen tegnes paa. Paa tv er det mindre end vinduet (se
 * TV_SCALE og TV_SAFE_MARGIN); App.tsx maaler fladen og saetter det her.
 */
export const CanvasContext = createContext<CanvasSize | null>(null);

/**
 * Laerredets stoerrelse, til skaerme der maa vide hvor meget plads de har.
 *
 * Brug denne og ikke useWindowDimensions: paa tv melder vinduet hele
 * skaermen, mens appen kun har laerredet. Guiden valgte tv-opstillingen
 * efter vinduets bredde og previewet i kanallisten fyldte 16:9 af
 * laerredets bredde, som var hele laerredets hoejde: kanallisten laa
 * under menulinjen. Paa telefonen er laerredet vinduet.
 */
export function useCanvasSize(): CanvasSize {
  const window = useWindowDimensions();
  const canvas = useContext(CanvasContext);
  return canvas ?? { width: window.width, height: window.height };
}

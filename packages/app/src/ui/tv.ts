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
 * 1,0: med 1,5 blev laerredet kun 324 punkter hoejt paa en 1080p-skaerm,
 * og guiden fik ingen plads til gitteret; med 1,2 var "alt stadig for
 * stort" fra sofaen. Med 1,0 er laerredet 864 x 486 punkter (efter den
 * frie kant), og skriften paa 14 punkter er praecis Googles anbefaling
 * til brodtekst paa tv. Under 1,0 bliver den mindre end mindstemaalet.
 */
export const TV_SCALE = 1.0;

/**
 * Fri kant hele vejen rundt paa tv, som andel af skaermen.
 *
 * Mange fjernsyn beskaerer HDMI-billedet et par procent (overscan), og
 * Google anbefaler 5 % fri kant til tv-apps af den grund. Men det
 * fjernsyn appen bruges paa viser hele billedet, og med 5 % stod der en
 * bred sort ramme om alt: "meget kant, hele skaermen bliver ikke
 * udnyttet". 1,5 % er luft nok til at intet klaeber til kanten.
 */
export const TV_SAFE_MARGIN = 0.015;

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

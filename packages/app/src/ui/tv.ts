import { Platform } from 'react-native';

/**
 * Tv, som i Apple TV og Android TV: skaermen sidder tre meter vaek, og
 * der er ingen fingre, kun en fjernbetjening med fokus.
 *
 * `Platform.isTV` kommer fra tv-udgaven af React Native (react-native-tvos)
 * og er falsk paa telefoner og web.
 */
export const isTV: boolean = Platform.isTV === true;

/**
 * Hele appen tegnes i 1280 x 720 og skaleres op til skaermens 1920 x 1080.
 * Saa er skrift, logoer og afstande halvanden gang stoerre end paa en
 * telefon uden at hver eneste stil skal aendres, og laesbar fra sofaen.
 */
export const TV_SCALE = 1.5;

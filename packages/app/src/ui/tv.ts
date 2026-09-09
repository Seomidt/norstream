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

/**
 * Fri kant hele vejen rundt paa tv, som andel af skaermen.
 *
 * Mange fjernsyn beskaerer HDMI-billedet et par procent (overscan), saa
 * det yderste forsvinder: menulinjen nederst laa under skaermens kant paa
 * et Bang & Olufsen. Google anbefaler 5 % fri kant til tv-apps af netop
 * den grund.
 */
export const TV_SAFE_MARGIN = 0.05;

import { Platform } from 'react-native';

/**
 * To temaer: moerkt og lyst. Appen foelger solen (ui/themeMode.ts): lyst
 * om dagen, moerkt naar det er moerkt udenfor, saa en lys flade ikke
 * traetter oejnene i en moerk stue. Man kan ogsaa laase den fast under
 * Indstillinger.
 *
 * Paa tv er fladerne lysere og kanterne tydeligere end paa telefonen:
 * #101014 mod #1b1b21 var ikke til at skelne fra sofaen, saa raekker og
 * kort havde ingen kanter, og man kunne ikke se hvor det ene holdt op.
 * Platform.isTV bruges direkte og ikke ui/tv.ts, saa temaet ikke
 * afhaenger af noget der afhaenger af temaet.
 *
 * Farverne laeses gennem useTheme()/useStyles() (ui/ThemeContext.tsx), ikke
 * herfra: et stilark bygget ved opstart kan ikke skifte, naar solen gaar ned.
 */
const tv = Platform.isTV === true;

export type ThemeScheme = 'dark' | 'light';

export interface ThemeColors {
  background: string;
  surface: string;
  surfaceRaised: string;
  text: string;
  textMuted: string;
  accent: string;
  danger: string;
  border: string;
  /** Bag et logo: mange kanallogoer er hvide paa gennemsigtig bund og forsvinder paa lyst. */
  logoBackdrop: string;
  /** Rammen om det der har fokus paa tv. Hvid paa moerkt; naesten sort paa lyst. */
  focusRing: string;
  /** Toningen af det der har fokus paa tv. */
  focusTint: string;
  /** Et naesten uigennemsigtigt kort oven paa et billede (onboardingens nordlys). */
  cardOverlay: string;
}

export const darkColors: ThemeColors = {
  background: tv ? '#0f1218' : '#101014',
  surface: tv ? '#1f2530' : '#1b1b21',
  surfaceRaised: tv ? '#2c3442' : '#26262e',
  text: '#f5f5f7',
  textMuted: tv ? '#aab2bd' : '#9aa0a6',
  accent: '#4c8dff',
  danger: '#ff5c5c',
  border: tv ? '#3a4353' : '#2f2f38',
  logoBackdrop: tv ? '#1f2530' : '#1b1b21',
  focusRing: '#ffffff',
  focusTint: 'rgba(76, 141, 255, 0.3)',
  cardOverlay: 'rgba(22, 22, 28, 0.94)',
};

/**
 * Lyst: en let graa bund, hvide flader, moerk skrift. Kontrasten er hoejere
 * paa tv, og accenten er moerkere end paa moerkt, saa hvid skrift paa den
 * stadig kan laeses.
 */
export const lightColors: ThemeColors = {
  background: tv ? '#eceef3' : '#f4f5f8',
  surface: '#ffffff',
  surfaceRaised: tv ? '#dfe3ea' : '#e8eaf0',
  text: '#14161c',
  textMuted: tv ? '#4f5664' : '#5c6270',
  accent: '#2f6fe0',
  danger: '#d93636',
  border: tv ? '#c3c9d4' : '#d5d9e2',
  logoBackdrop: '#2a2f3a',
  focusRing: '#14161c',
  focusTint: 'rgba(47, 111, 224, 0.18)',
  cardOverlay: 'rgba(255, 255, 255, 0.94)',
};

export function colorsFor(scheme: ThemeScheme): ThemeColors {
  return scheme === 'light' ? lightColors : darkColors;
}

/**
 * Afstande og hjoerner, ens i begge temaer. `colors` er det moerke tema og
 * findes for NorRadio, som ikke skifter tema; i NorStream laeses farverne
 * gennem useTheme().
 */
export const theme = {
  colors: darkColors,
  spacing: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 },
  radius: 10,
} as const;

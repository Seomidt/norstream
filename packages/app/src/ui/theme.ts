import { Platform } from 'react-native';

/**
 * Moerkt tema, som de andre tv-apps og som Google anbefaler til tv: en lys
 * flade i en moerk stue traetter, og logoer og plakater staar bedst paa
 * moerkt.
 *
 * Paa tv er fladerne lysere og kanterne tydeligere end paa telefonen:
 * #101014 mod #1b1b21 var ikke til at skelne fra sofaen, saa raekker og
 * kort havde ingen kanter, og man kunne ikke se hvor det ene holdt op.
 * Platform.isTV bruges direkte og ikke ui/tv.ts, saa temaet ikke
 * afhaenger af noget der afhaenger af temaet.
 */
const tv = Platform.isTV === true;

export const theme = {
  colors: {
    background: tv ? '#0f1218' : '#101014',
    surface: tv ? '#1f2530' : '#1b1b21',
    surfaceRaised: tv ? '#2c3442' : '#26262e',
    text: '#f5f5f7',
    textMuted: tv ? '#aab2bd' : '#9aa0a6',
    accent: '#4c8dff',
    danger: '#ff5c5c',
    border: tv ? '#3a4353' : '#2f2f38',
  },
  spacing: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 },
  radius: 10,
} as const;

/**
 * Moduler der ikke findes paa Apple TV.
 *
 * react-native-webview bygger kun til iOS, macOS og visionOS; i en tv-build
 * (EXPO_TV=1) ville Xcode stoppe paa den. Saa slaas den fra dér, og appen
 * henter den bag en platformstest (features/vod/webview.ts). Paa telefonen
 * roeres intet.
 */
const isTvBuild = process.env.EXPO_TV === '1' || process.env.EXPO_TV === 'true';

module.exports = {
  dependencies: isTvBuild
    ? {
        'react-native-webview': {
          platforms: { ios: null },
        },
      }
    : {},
};

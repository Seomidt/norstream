import { requireNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';
import type { PanelEpgNative } from '../../src/sync/panelEpg.js';

/**
 * Broen til PanelEpgModule.kt: panelets store XMLTV-fil laeses i en
 * baggrundstraad paa Android. Null paa andre platforme og uden modulet —
 * saa faar man bare panelets EPG per kanal, som foer.
 */
let native: PanelEpgNative | null = null;
if (Platform.OS === 'android') {
  try {
    native = requireNativeModule('PanelEpg') as PanelEpgNative;
  } catch {
    native = null;
  }
}

export const panelEpgNative = native;

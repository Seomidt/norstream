import { requireNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';
import type { WatchNextNative } from '../../src/features/vod/watchNext.js';

/**
 * Broen til WatchNextModule.kt (Google TV's "Fortsaet med at se"). Null paa
 * andre platforme og uden modulet — saa sker der bare ingenting.
 */
let native: WatchNextNative | null = null;
if (Platform.OS === 'android') {
  try {
    native = requireNativeModule('WatchNext') as WatchNextNative;
  } catch {
    native = null;
  }
}

export const watchNextNative = native;

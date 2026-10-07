import { requireNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';
import type { ProcessDiagnosticsNative } from '../../src/diagnostics/processExit.js';

let native: ProcessDiagnosticsNative | null = null;
if (Platform.OS === 'android') {
  try {
    native = requireNativeModule('ProcessDiagnostics') as ProcessDiagnosticsNative;
  } catch {
    // Expo Go og andre builds uden modulet skal stadig kunne starte.
  }
}

export const processDiagnosticsNative = native;

import { requireNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';

/**
 * USB-drev der sidder i (Android). Hvert drev har en mappe appen maa
 * skrive i uden at spoerge om lov; se UsbStorageModule.kt. Tom liste paa
 * andre platforme, og naar modulet ikke er med i bygget.
 */
export interface UsbVolume {
  /** Appens egen mappe paa drevet, som en almindelig sti. */
  path: string;
  /** Drevets navn som Android kalder det, fx "SanDisk USB-drev". */
  name: string;
  uuid: string | null;
}

interface NativeModule {
  volumes(): UsbVolume[];
}

let native: NativeModule | null = null;
if (Platform.OS === 'android') {
  try {
    native = requireNativeModule('UsbStorage') as NativeModule;
  } catch {
    native = null;
  }
}

export function usbVolumes(): UsbVolume[] {
  try {
    return native?.volumes() ?? [];
  } catch {
    return [];
  }
}

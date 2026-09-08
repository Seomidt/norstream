import { Platform } from 'react-native';
import type { ComponentType } from 'react';
import type { VLCPlayerProps } from 'react-native-vlc-media-player';

/**
 * VLC, til det ExoPlayer ikke kan afkode.
 *
 * Android har ingen dekoder til MPEG-1 Layer II, som radio fra DVB typisk
 * sendes med; ExoPlayer melder "spiller, ét lydspor" og er stum. libVLC
 * afkoder selv, alt. Den er et native-modul der kun findes paa telefonerne,
 * saa den hentes bag en platformstest: paa web er den null, og radio gaar
 * som foer gennem ExoPlayer.
 */
export type VlcPlayerComponent = ComponentType<VLCPlayerProps>;

export function vlcPlayer(): VlcPlayerComponent | null {
  if (Platform.OS === 'web') return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const loaded = require('react-native-vlc-media-player') as { VLCPlayer?: VlcPlayerComponent };
    return loaded.VLCPlayer ?? null;
  } catch {
    return null;
  }
}

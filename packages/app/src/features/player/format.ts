import { Platform } from 'react-native';
import type { StreamFormat } from '@norstream/core';
import type { StreamFormatSetting } from '../../storage/settings.js';

/**
 * Brugerens valg, holdt som modultilstand.
 *
 * Det er en enkelt indstilling for hele enheden, og den laeses synkront fra
 * fire steder — afspilleren to gange, previewet, og fallback-reglen. At traede
 * den gennem hver komponent ville koste mere end den er vaerd, og at gøre
 * `formatForPlatform` asynkron ville tvinge baade afspilleren og previewet til
 * at vente paa en databaselaesning foer de kan aabne en stream.
 *
 * Saettes ét sted: `createSession`, foer noget kan tegnes.
 */
let setting: StreamFormatSetting = 'auto';

export function applyStreamFormatSetting(value: StreamFormatSetting): void {
  setting = value;
}

/**
 * AVPlayer paa iOS og tvOS kan ikke afspille raa MPEG-TS over HTTP, saa
 * Apple-platforme og web skal have HLS. Android faar .ts for lavere latenstid.
 *
 * Ligger i sit eget modul fordi baade afspilleren og mini-previewet skal
 * traeffe det samme valg. To kopier ville kunne skride fra hinanden, og
 * konsekvensen — en stream der aldrig starter paa én af de to flader — ville
 * ligne et netvaerksproblem.
 */
export function formatForPlatform(): StreamFormat {
  if (setting !== 'auto') return setting;
  return Platform.OS === 'android' ? 'ts' : 'm3u8';
}

/**
 * Der findes kun et brugbart fallback-format naar det primaere var .ts — paa
 * Android, eller hvor brugeren selv har valgt .ts. Spec sec.8: AVPlayer kan ikke afspille raa MPEG-TS over
 * HTTP, saa paa iOS, tvOS og web ville et skift til .ts vaere en garanteret
 * fejl — og det ville braende det eneste fallback-forsoeg, saa en HLS-hikke
 * der kunne have rettet sig selv ender i en doed stream.
 */
export function hasFormatFallback(): boolean {
  return formatForPlatform() === 'ts';
}

/** Det andet containerformat. Kun meningsfuldt naar hasFormatFallback() er sand. */
export const FALLBACK_FORMAT: StreamFormat = 'm3u8';

/** Videooverfladen, sat fra Indstillinger og laest af afspilleren. Se storage/settings getVideoSurface. */
let surface: 'surface' | 'texture' = 'surface';

export function applyVideoSurfaceSetting(value: 'surface' | 'texture'): void {
  surface = value;
}

/** Til VideoView paa Android: surfaceView (standard) eller textureView. */
export function surfaceTypeForPlatform(): 'surfaceView' | 'textureView' {
  return surface === 'texture' ? 'textureView' : 'surfaceView';
}

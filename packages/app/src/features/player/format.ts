import { Platform } from 'react-native';
import type { StreamFormat } from '@norstream/core';

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
  return Platform.OS === 'android' ? 'ts' : 'm3u8';
}

/**
 * Der findes kun et brugbart fallback-format naar det primaere var .ts, altsaa
 * kun paa Android. Spec sec.8: AVPlayer kan ikke afspille raa MPEG-TS over
 * HTTP, saa paa iOS, tvOS og web ville et skift til .ts vaere en garanteret
 * fejl — og det ville braende det eneste fallback-forsoeg, saa en HLS-hikke
 * der kunne have rettet sig selv ender i en doed stream.
 */
export function hasFormatFallback(): boolean {
  return formatForPlatform() === 'ts';
}

/** Det andet containerformat. Kun meningsfuldt naar hasFormatFallback() er sand. */
export const FALLBACK_FORMAT: StreamFormat = 'm3u8';

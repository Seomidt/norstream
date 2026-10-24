import type { FetchLikeResponse } from '@norstream/core';
import type { HeaderFetch } from './doh.js';

const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * Bygger den FetchLike core's XtreamClient forbruger, med timeout.
 * Et panel der haenger maa ikke kunne fryse opstarten; core kaster
 * XtreamNetworkError paa afvisningen, og appen falder tilbage paa cache.
 */
export function createFetchImpl(
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
  underlying: typeof fetch = fetch,
): HeaderFetch {
  return async (url: string, headers?: Record<string, string>): Promise<FetchLikeResponse> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      // Hoveder kun naar der er nogen: DNS-noedudgangen sender navnet som Host.
      const response = await underlying(url, headers === undefined ? { signal: controller.signal } : { signal: controller.signal, headers });
      // `text` skal med. Uden den fejlede alt der laeser en krop som tekst —
      // M3U-lister, XMLTV-oversigter og logo-registret — og de fejlede
      // *stille*, som om filen bare ikke var hentet endnu.
      return {
        ok: response.ok,
        status: response.status,
        json: () => response.json() as Promise<unknown>,
        text: () => response.text(),
        // Raa bytes til XMLTV-vejen, saa en gzippet oversigt kan pakkes ud.
        arrayBuffer: () => response.arrayBuffer(),
      };
    } finally {
      clearTimeout(timer);
    }
  };
}

import type { FetchLike, FetchLikeResponse } from '@norstream/core';

const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * Bygger den FetchLike core's XtreamClient forbruger, med timeout.
 * Et panel der haenger maa ikke kunne fryse opstarten; core kaster
 * XtreamNetworkError paa afvisningen, og appen falder tilbage paa cache.
 */
export function createFetchImpl(
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
  underlying: typeof fetch = fetch,
): FetchLike {
  return async (url: string): Promise<FetchLikeResponse> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await underlying(url, { signal: controller.signal });
      // `text` skal med. Uden den fejlede alt der laeser en krop som tekst —
      // M3U-lister, XMLTV-oversigter og logo-registret — og de fejlede
      // *stille*, som om filen bare ikke var hentet endnu.
      return {
        ok: response.ok,
        status: response.status,
        json: () => response.json() as Promise<unknown>,
        text: () => response.text(),
      };
    } finally {
      clearTimeout(timer);
    }
  };
}

import type { FetchLike } from '@norstream/core';

export interface LogoProbeResult {
  /** Kort dansk linje der siger hvad der skete. */
  text: string;
  /** Sand naar adressen gav noget der ligner et billede. */
  ok: boolean;
}

/**
 * Henter en logo-adresse og siger hvad der kom tilbage.
 *
 * Et `Image` der ikke tegner noget er ubrugeligt som diagnose: react-native
 * melder ikke altid fejl, og en tom firkant kan lige saa godt vaere en
 * hentning der stadig venter, et svar der ikke er et billede, eller et
 * gennemsigtigt billede. Tre aarsager, ét udseende.
 *
 * Et rigtigt kald siger derimod hvad der skete: en HTTP-status, en
 * indholdstype og et antal bytes — eller den netvaerksfejl der forhindrede
 * det. Det er forskellen paa at vide og at gaette.
 */
export async function probeLogo(url: string, fetchImpl: FetchLike): Promise<LogoProbeResult> {
  let response;
  try {
    response = await fetchImpl(url);
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    return { text: `Telefonen kunne slet ikke nå adressen: ${detail}`, ok: false };
  }

  if (!response.ok) {
    return { text: `Adressen svarede HTTP ${response.status}.`, ok: false };
  }

  // Nogle paneler svarer 200 med en fejlside i stedet for et billede.
  const type = headerOf(response, 'content-type');
  const length = headerOf(response, 'content-length');
  const looksLikeImage = type !== null && type.startsWith('image/');
  const size = length === null ? 'ukendt størrelse' : `${length} bytes`;

  if (!looksLikeImage) {
    return {
      text: `Adressen svarede HTTP 200, men med ${type ?? 'ukendt indholdstype'} — ikke et billede.`,
      ok: false,
    };
  }

  return { text: `Adressen svarede HTTP 200 med ${type}, ${size}.`, ok: true };
}

/**
 * Laeser en header uden at antage hvordan svaret er formet. `FetchLike` lover
 * kun status, ok og json, saa headers kan mangle helt — og et diagnoseværktøj
 * der selv kaster er ikke til megen hjaelp.
 */
function headerOf(response: unknown, name: string): string | null {
  if (typeof response !== 'object' || response === null) return null;
  const headers = (response as { headers?: unknown }).headers;
  if (typeof headers !== 'object' || headers === null) return null;
  const get = (headers as { get?: unknown }).get;
  if (typeof get !== 'function') return null;
  try {
    const value = (get as (key: string) => unknown).call(headers, name);
    return typeof value === 'string' && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

import { buildLiveUrl, parseChannelKey } from '@norstream/core';
import type { Source, StreamFormat, XtreamCredentials } from '@norstream/core';

/**
 * En kilde sammen med det der skal til for at tale med den.
 *
 * Adgangskoden ligger i Keychain og hentes ved opstart; den staar aldrig i
 * databasen. M3U-kilder har ingen legitimation — deres adresser er faerdige.
 */
export interface SourceAccess {
  source: Source;
  /** Kun Xtream. `null` for M3U. */
  creds: XtreamCredentials | null;
}

/**
 * Grupperer kanalnoegler efter kilde.
 *
 * Alle lag der henter noget — programdata, arkiv, optagelser — faar en liste
 * af noegler der udmaerket kan komme fra flere kilder ad gangen: guiden viser
 * favoritter, og de kan ligge paa hvert sit panel. Uden grupperingen ville
 * appen spoerge det ene panel om det andets kanaler, og faa tomme svar den
 * ikke kunne skelne fra "ingen programdata".
 */
export function groupBySource(keys: readonly string[]): Map<string, string[]> {
  const grouped = new Map<string, string[]>();
  for (const key of keys) {
    const parts = parseChannelKey(key);
    if (parts === null) continue;
    const existing = grouped.get(parts.sourceId);
    if (existing === undefined) grouped.set(parts.sourceId, [key]);
    else existing.push(key);
  }
  return grouped;
}

/**
 * Adressen der skal afspilles for en kanal.
 *
 * M3U-kanaler baerer deres egen faerdige adresse — der er intet API at bygge
 * en med. Xtream-kanaler bygger deres af panelets legitimation og kanalens
 * eget id, som er den del af noeglen der staar efter kilden.
 *
 * `null` naar kilden mangler eller ikke kan levere en adresse; kalderen skal
 * sige det frem for at aabne en tom afspiller.
 */
export function liveUrlFor(
  access: SourceAccess | null,
  channel: { streamId: string; streamUrl: string | null },
  format: StreamFormat,
): string | null {
  if (channel.streamUrl !== null && channel.streamUrl.length > 0) return channel.streamUrl;
  if (access === null || access.creds === null) return null;
  return buildLiveUrl(access.creds, channel.streamId, format);
}

/** Legitimation per kilde, som hente-lagene slaar op i. */
export function credentialsBySource(
  accesses: readonly SourceAccess[],
): Map<string, XtreamCredentials> {
  const map = new Map<string, XtreamCredentials>();
  for (const access of accesses) {
    if (access.creds !== null) map.set(access.source.id, access.creds);
  }
  return map;
}

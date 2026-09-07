import type { FetchLike, XtreamCredentials } from '@norstream/core';
import { withPanelCooldown } from './net/cooldown.js';
import { createFetchImpl } from './net/fetchImpl.js';
import { initLogoMemory } from './ui/logoMemory.js';
import { applyStreamFormatSetting } from './features/player/format.js';
import { credentialsBySource } from './sources/access.js';
import type { SourceAccess } from './sources/access.js';
import { openDatabase } from './storage/db.js';
import {
  clearLegacyCredentials,
  loadLegacyCredentials,
  loadSourceCredentials,
  saveSourceCredentials,
} from './storage/credentials.js';
import { addSource, adoptLegacyKeys, listEnabledSources } from './storage/sources.js';
import { adoptLegacySettings, getStreamFormatSetting } from './storage/settings.js';
import type { SqlDatabase } from './storage/types.js';

export interface AppSession {
  db: SqlDatabase;
  fetchImpl: FetchLike;
  /** Alle aktive kilder med det der skal til for at tale med dem. */
  sources: SourceAccess[];
  /** Legitimation slaaet op paa kilde, som hente-lagene bruger. */
  credsBySource: ReadonlyMap<string, XtreamCredentials>;
  /** Kilden en kanal hoerer til, eller null naar den er fjernet. */
  access(sourceId: string): SourceAccess | null;
}

/**
 * Samler alle kilder og deres adgangsoplysninger.
 *
 * En kilde uden legitimation i Keychain tages **med** som Xtream uden creds:
 * saa siger appen "kilden mangler adgangsoplysninger" i stedet for at lade som
 * om kanalerne ikke findes.
 */
async function readSources(db: SqlDatabase): Promise<SourceAccess[]> {
  const sources = await listEnabledSources(db);
  const accesses: SourceAccess[] = [];
  for (const source of sources) {
    const creds = source.kind === 'xtream' ? await loadSourceCredentials(source.id) : null;
    accesses.push({ source, creds });
  }
  return accesses;
}

/**
 * Flytter installationen fra ét panel til kilder.
 *
 * Enheder fra foer kilderne fandtes har adgangsoplysningerne under den gamle
 * noegle og favoritter uden kilde-praefiks. Den ene gang det sker, laves der en
 * kilde af dem, og alt brugeren har skabt faar den nye noegle. Uden det ville
 * en opgradering se ud som en app der havde glemt alt.
 */
export async function adoptLegacyInstallation(db: SqlDatabase): Promise<void> {
  if ((await listEnabledSources(db)).length > 0) return;
  const legacy = await loadLegacyCredentials();
  if (legacy === null) return;

  const source = await addSource(db, {
    kind: 'xtream',
    name: hostOf(legacy.baseUrl),
    url: legacy.baseUrl,
    username: legacy.username,
  });
  await saveSourceCredentials(source.id, legacy);
  await adoptLegacyKeys(db, source.id);
  await adoptLegacySettings(db, source.id);
  await clearLegacyCredentials();
}

/** Et brugbart navn til den kilde der bliver lavet af de gamle oplysninger. */
function hostOf(url: string): string {
  const match = /^[a-z]+:\/\/([^/:]+)/i.exec(url.trim());
  return match?.[1] ?? 'Panel';
}

export async function createSession(): Promise<AppSession> {
  const db = await openDatabase();
  await adoptLegacyInstallation(db);

  // Streamformatet laeses her, foer noget kan tegnes: baade afspilleren og
  // previewet bygger deres URL synkront i foerste render, og et format der
  // skiftede bagefter ville aabne stream nummer to paa et panel der kun
  // tillader én.
  applyStreamFormatSetting(await getStreamFormatSetting(db));
  // Hvilke logo-adresser der virkede sidst. Laeses ind foer noget tegnes,
  // af samme grund som streamformatet: logoerne tegnes synkront.
  await initLogoMemory(db);

  const sources = await readSources(db);
  return {
    db,
    fetchImpl: withPanelCooldown(createFetchImpl()),
    sources,
    credsBySource: credentialsBySource(sources),
    access: (sourceId) => sources.find((entry) => entry.source.id === sourceId) ?? null,
  };
}

/** Laeser kilderne igen, fx efter at en er tilfoejet eller fjernet. */
export async function reloadSources(session: AppSession): Promise<AppSession> {
  const sources = await readSources(session.db);
  return {
    ...session,
    sources,
    credsBySource: credentialsBySource(sources),
    access: (sourceId) => sources.find((entry) => entry.source.id === sourceId) ?? null,
  };
}

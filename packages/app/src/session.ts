import type { XtreamCredentials } from '@norstream/core';
import { withPanelCooldown } from './net/cooldown.js';
import { createFetchImpl } from './net/fetchImpl.js';
import { withDnsFallback } from './net/doh.js';
import type { HeaderFetch } from './net/doh.js';
import { initLogoCache } from './ui/logoCache.js';
import { createLogoFileStore } from './ui/logoFiles.js';
import { initPosterFill } from './ui/posterFill.js';
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
  fetchImpl: HeaderFetch;
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
  // Legitimationen for hver kilde paa én gang: hver er en Keychain-oplaesning
  // (Android Keystore-dekrypt), og serielt var de N runde-ture foran foerste
  // tegning. Promise.all bevarer raekkefoelgen og aendrer intet i hvad der laeses.
  return Promise.all(
    sources.map(async (source) => ({
      source,
      creds: source.kind === 'xtream' ? await loadSourceCredentials(source.id) : null,
    })),
  );
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

  // De uafhaengige opstarts-laesninger paa én gang i stedet for i koe: de
  // afhaenger kun af db, ikke af hinanden, men laa foer serielt foran foerste
  // tegning (og logo-cachen alene er to fuld-tabel-laesninger). Nu overlapper
  // ventetiden.
  //  - streamformat: afspiller og preview bygger deres URL synkront i foerste
  //    render, saa det SKAL vaere sat foer noget tegnes — derfor anvendes det
  //    straks resultatet er der, og altid foer retur (som er foer render).
  //  - logo-cache: logoerne tegnes synkront fra den; skal ligeledes ligge klar.
  //  - kilder (med legitimation) og plakat-udfyldning: som foer.
  const [format, , sources] = await Promise.all([
    getStreamFormatSetting(db),
    initLogoCache(db, createLogoFileStore()),
    readSources(db),
    // Plakater til film og serier uden: slaas op efterhaanden som de vises.
    initPosterFill(db),
  ]);
  applyStreamFormatSetting(format);

  // Nedkoelingen yderst (den ser panelets navn), DNS-noedudgangen inderst.
  const fetchImpl = withPanelCooldown(withDnsFallback(createFetchImpl()));
  return {
    db,
    fetchImpl,
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

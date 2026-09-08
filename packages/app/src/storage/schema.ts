import type { SqlDatabase } from './types.js';

/**
 * Alle tidsstempler gemmes som epoch-millisekunder i INTEGER-kolonner,
 * aldrig som tekst: guidens tidsvindue-forespoergsler skal kunne bruge
 * indekset, og en tekstsammenligning ville forhindre det.
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS categories (
  id   TEXT PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS channels (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  number         INTEGER,
  logo_url       TEXT,
  category_id    TEXT,
  epg_channel_id TEXT,
  has_archive    INTEGER NOT NULL DEFAULT 0,
  archive_days   INTEGER NOT NULL DEFAULT 0,
  is_stale       INTEGER NOT NULL DEFAULT 0,
  sort_order     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS favorites (
  channel_id TEXT PRIMARY KEY
);

CREATE INDEX IF NOT EXISTS idx_channels_category ON channels (category_id);
CREATE INDEX IF NOT EXISTS idx_channels_epg      ON channels (epg_channel_id);

-- Kanallisten sorterer altid paa sort_order. Uden dette indeks svarer SQLite
-- med "USE TEMP B-TREE FOR ORDER BY" og bygger et midlertidigt trae over alle
-- 22.142 raekker ved hvert eneste opslag — ogsaa ved hvert tastetryk i soegningen.
CREATE INDEX IF NOT EXISTS idx_channels_sort ON channels (sort_order);

CREATE TABLE IF NOT EXISTS programmes (
  channel_id  TEXT    NOT NULL,
  start_ms    INTEGER NOT NULL,
  stop_ms     INTEGER NOT NULL,
  title       TEXT    NOT NULL,
  description TEXT,
  PRIMARY KEY (channel_id, start_ms)
);

CREATE INDEX IF NOT EXISTS idx_programmes_window
  ON programmes (channel_id, start_ms, stop_ms);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

/**
 * Skemaversionen stemples i databasen, saa en fremtidig migrering har et tal
 * at forgrene paa i stedet for at gaette paa hvilke kolonner der findes.
 * Ingen migreringsramme her — kun tallet.
 *
 * Bevidst stadig 1: alt i SCHEMA er `IF NOT EXISTS` og koeres ved hver aabning,
 * saa et tilfoejet indeks naar frem til eksisterende databaser uden en
 * forgrening. Version 2 er reserveret til EPG-omlaegningen, der faktisk aendrer
 * kolonner — se specs/2026-09-05-navigation-og-epg-design.md.
 */
const SCHEMA_VERSION = 1;

/**
 * Ydelses-pragmaer. Skal saettes foer skemaet, og ved hver aabning:
 * `journal_mode` gemmes i selve databasefilen, men `synchronous` gaelder kun
 * den aktuelle forbindelse.
 *
 * WAL alene bringer en kanalsynkronisering fra 26.184 ms til 1.507 ms, og
 * sammen med transaktionerne i storage-laget til 63 ms (maalt paa en
 * fil-database med panelets 22.142 kanaler). WAL lader desuden laesninger
 * koere mens en synkronisering skriver, saa kanallisten ikke fryser bag den.
 *
 * `synchronous = NORMAL` er det anbefalede niveau sammen med WAL: der kan
 * tabes de allersidste committede skrivninger ved et strømsvigt, men
 * databasen kan ikke blive korrupt. Det vi ville tabe er en kanalliste appen
 * alligevel henter igen fra panelet.
 *
 * Fejler pragmaerne, gaar appen videre uden dem. De er en optimering, ikke en
 * forudsaetning — og paa web koerer expo-sqlite mod en helt anden motor, hvor
 * en afvist pragma ikke maa kunne blokere opstarten.
 */
async function applyPerformancePragmas(db: SqlDatabase): Promise<void> {
  try {
    await db.execAsync('PRAGMA journal_mode = WAL');
    await db.execAsync('PRAGMA synchronous = NORMAL');
  } catch {
    // Med vilje tavs — se ovenfor.
  }
}

export async function migrate(db: SqlDatabase): Promise<void> {
  await applyPerformancePragmas(db);
  await db.execAsync(SCHEMA);
  await db.execAsync(`PRAGMA user_version = ${SCHEMA_VERSION}`);
}

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
  is_favorite    INTEGER NOT NULL DEFAULT 0,
  sort_order     INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_channels_category ON channels (category_id);
CREATE INDEX IF NOT EXISTS idx_channels_epg      ON channels (epg_channel_id);

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

export async function migrate(db: SqlDatabase): Promise<void> {
  await db.execAsync(SCHEMA);
}

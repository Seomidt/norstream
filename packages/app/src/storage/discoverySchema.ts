/** Additive katalogtabeller. Brugerens fremdrift og eksisterende favoritter bevares. */
export const DISCOVERY_SCHEMA = `
CREATE TABLE IF NOT EXISTS movie_collections (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  poster_url TEXT,
  fetched_ms INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS movie_collection_members (
  collection_id INTEGER NOT NULL REFERENCES movie_collections(id) ON DELETE CASCADE,
  tmdb_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  original_title TEXT,
  year INTEGER,
  release_date TEXT,
  poster_url TEXT,
  PRIMARY KEY (collection_id, tmdb_id)
);
CREATE INDEX IF NOT EXISTS idx_collection_member_tmdb ON movie_collection_members(tmdb_id);
CREATE TABLE IF NOT EXISTS movie_collection_lookup (
  item_key TEXT PRIMARY KEY,
  item_name TEXT NOT NULL,
  tmdb_id INTEGER,
  collection_id INTEGER,
  checked_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_collection_lookup_collection ON movie_collection_lookup(collection_id);
CREATE TABLE IF NOT EXISTS followed_series_state (
  series_key TEXT PRIMARY KEY,
  initialized_ms INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS followed_episode_state (
  series_key TEXT NOT NULL,
  season INTEGER NOT NULL,
  episode INTEGER NOT NULL,
  first_seen_ms INTEGER NOT NULL,
  acknowledged_ms INTEGER,
  PRIMARY KEY (series_key, season, episode)
);
CREATE INDEX IF NOT EXISTS idx_followed_episode_new ON followed_episode_state(series_key, acknowledged_ms);
`;

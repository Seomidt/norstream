import { MATCH_KEY_VERSION } from '@norstream/core';
import type { SqlDatabase } from './types.js';

/**
 * Alle tidsstempler gemmes som epoch-millisekunder i INTEGER-kolonner,
 * aldrig som tekst: guidens tidsvindue-forespoergsler skal kunne bruge
 * indekset, og en tekstsammenligning ville forhindre det.
 *
 * **`programmes.channel_id` er Xtreams `stream_id`, ikke et XMLTV-kanal-id.**
 * Kolonnenavnet er bevaret for at holde aendringen lille, men betydningen er
 * skiftet i v2: EPG hentes nu per kanal med `get_short_epg`, som slaar op paa
 * `stream_id`. 87 % af panelets kanaler har intet `epg_channel_id`, og med det
 * som noegle ville de aldrig kunne faa programdata.
 */
const SCHEMA = `
-- Hvert sted kanaler kommer fra: et Xtream-panel eller en M3U-liste.
-- Adgangskoder staar her **ikke**; de ligger i Keychain under kildens id.
CREATE TABLE IF NOT EXISTS sources (
  id         TEXT PRIMARY KEY,
  kind       TEXT NOT NULL,
  name       TEXT NOT NULL,
  url        TEXT NOT NULL,
  username   TEXT,
  xmltv_url  TEXT,
  enabled    INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS categories (
  id        TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  name      TEXT NOT NULL
);

-- id er kildens id og kanalens eget id sat sammen; stream_id er kanalens eget.
-- To udbydere har begge en kanal 1, og uden den sammensatte noegle ville den
-- ene overskrive den anden ved naeste synkronisering.
--
-- stream_url er kun for M3U-kanaler, som ikke har et API at bygge en URL med.
CREATE TABLE IF NOT EXISTS channels (
  id             TEXT PRIMARY KEY,
  source_id      TEXT NOT NULL,
  stream_id      TEXT NOT NULL,
  stream_url     TEXT,
  -- Kanalnavnet renset for landepraefiks og kvalitetsmaerker, plus landet
  -- udledt af kategorien. De to er noeglen ind i det aabne logo-register;
  -- de beregnes ved synkronisering, fordi SQL ikke kan normalisere et navn.
  match_key      TEXT NOT NULL DEFAULT '',
  country        TEXT NOT NULL DEFAULT '',
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

CREATE INDEX IF NOT EXISTS idx_channels_source ON channels (source_id);

CREATE TABLE IF NOT EXISTS favorites (
  channel_id         TEXT PRIMARY KEY,
  source_category_id TEXT,
  -- Brugerens egen raekkefoelge. Nye favoritter laegger sig nederst; en hel
  -- kategori laegges nederst i panelets orden. Kan flyttes under Favoritter.
  position           INTEGER
);

-- Kanaler brugeren har fjernet fra en favoriseret kategori. Uden den ville
-- "opdatér" paa kategorien haente dem tilbage hver gang, og en oprydning i
-- 979 danske kanaler skulle laves forfra efter hvert tryk.
CREATE TABLE IF NOT EXISTS favorite_exclusions (
  channel_id  TEXT PRIMARY KEY,
  category_id TEXT NOT NULL
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
-- Til oprydningen af gamle programmer, som ellers laeser hele tabellen.
CREATE INDEX IF NOT EXISTS idx_programmes_stop ON programmes (stop_ms);

CREATE TABLE IF NOT EXISTS epg_fetch (
  stream_id  TEXT    PRIMARY KEY,
  fetched_at INTEGER NOT NULL
);

-- Hentetid for den fulde programtabel (get_simple_data_table), som er den
-- eneste kilde til programmer der allerede er sendt. Den ligger for sig selv,
-- fordi de to hentninger har hver sit formaal og hver sin levetid: "nu og
-- naeste" forældes paa en halv time, mens fortiden ikke aendrer sig.
CREATE TABLE IF NOT EXISTS epg_archive_fetch (
  stream_id  TEXT    PRIMARY KEY,
  fetched_at INTEGER NOT NULL
);

-- Landet gemmes som sin noegle — ISO-koden, eller '__other__' for de
-- kategorier hvis navn ikke rummer et genkendeligt land. Noeglen er stabil;
-- det viste navn er dansk tekst der kan aendre sig.
CREATE TABLE IF NOT EXISTS hidden_countries (
  name TEXT PRIMARY KEY
);

-- Optagelser. Panelet har ingen optagefunktion; det appen kan, er at hente
-- udsendelsen ned fra panelets *arkiv* efter den er sendt. En optagelse er
-- derfor et loefte om en hentning, ikke en igangvaerende optagelse.
--
-- Kanalnavn og arkivlaengde staar med her frem for at blive slaaet op i
-- channels: en optaget udsendelse skal overleve at kanalen forsvinder fra
-- panelet, og skal stadig kunne vise hvad den er.
CREATE TABLE IF NOT EXISTS recordings (
  id           TEXT PRIMARY KEY,
  channel_id   TEXT NOT NULL,
  channel_name TEXT NOT NULL,
  title        TEXT NOT NULL,
  description  TEXT,
  start_ms     INTEGER NOT NULL,
  stop_ms      INTEGER NOT NULL,
  archive_days INTEGER NOT NULL,
  state        TEXT NOT NULL,
  file_uri     TEXT,
  bytes        INTEGER NOT NULL DEFAULT 0,
  error        TEXT,
  created_at   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_recordings_start ON recordings (start_ms);

-- Logoer fra det aabne kanalregister, som reserve for de kanaler hvor
-- udbyderens egen logo-adresse mangler eller ikke kan naas. Ren cache: den
-- kan altid hentes igen, og den ryddes ved hver opdatering.
CREATE TABLE IF NOT EXISTS registry_logos (
  key     TEXT PRIMARY KEY,
  country TEXT NOT NULL,
  url     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Logoer fra en XMLTV-fil. Det er her standarden har dem: <channel><icon>.
-- Slaaet op paa appens egen kanalnoegle, fordi koblingen fra XMLTV-id eller
-- navn til kanal allerede sker naar programoversigten hentes.
CREATE TABLE IF NOT EXISTS xmltv_logos (
  channel_key TEXT PRIMARY KEY,
  url         TEXT NOT NULL
);

-- Hvilken af kanalens logo-adresser der faktisk tegnede sidst. Uden den
-- proeves de doede adresser forfra hver gang raekken kommer paa skaermen.
CREATE TABLE IF NOT EXISTS logo_resolved (
  channel_key TEXT PRIMARY KEY,
  url         TEXT NOT NULL
);

-- Logoer brugeren selv har valgt. Staar foerst i raekken, foer alt hvad
-- udbyderen og arkiverne siger: det er brugerens eget ord.
CREATE TABLE IF NOT EXISTS logo_overrides (
  channel_key TEXT PRIMARY KEY,
  url         TEXT NOT NULL
);

-- Logoer hentet ned paa telefonen, ét per kanal. Et logo hentes én gang og
-- tegnes derefter fra filen, uden netvaerk. Raekken siger filens navn i
-- logomappen og hvilken adresse den kom fra. Navnet, ikke hele stien: paa
-- iPhone flytter appens mappe ved hver opdatering.
CREATE TABLE IF NOT EXISTS logo_files (
  channel_key TEXT PRIMARY KEY,
  url         TEXT NOT NULL,
  file        TEXT NOT NULL,
  bytes       INTEGER NOT NULL,
  fetched_ms  INTEGER NOT NULL
);

-- Kanaler hvor ingen af adresserne gav et logo, og hvornaar det blev
-- proevet. Uden den ville hver rulning forbi en kanal uden logo koste de
-- samme forgaeves opkald igen. Adresserne der blev proevet staar med, saa
-- en ny adresse (nyt register, eget valg) proeves med det samme.
CREATE TABLE IF NOT EXISTS logo_misses (
  channel_key TEXT PRIMARY KEY,
  tried       TEXT NOT NULL,
  tried_ms    INTEGER NOT NULL
);

-- Film og serier. Samme moenster som kanalerne: listen hentes én gang i
-- doegnet per kilde; det panelet ved om den enkelte titel hentes foerst naar
-- den aabnes, og ligger i vod_details og episodes.
CREATE TABLE IF NOT EXISTS vod_categories (
  id        TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  kind      TEXT NOT NULL,
  name      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS vod_items (
  key           TEXT PRIMARY KEY,
  source_id     TEXT NOT NULL,
  item_id       TEXT NOT NULL,
  kind          TEXT NOT NULL,
  name          TEXT NOT NULL,
  poster_url    TEXT,
  category_id   TEXT,
  rating        REAL,
  year          INTEGER,
  added_ms      INTEGER,
  container_ext TEXT,
  sort_order    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_vod_items_category ON vod_items (category_id);
CREATE INDEX IF NOT EXISTS idx_vod_items_kind     ON vod_items (kind, sort_order);

CREATE TABLE IF NOT EXISTS vod_details (
  item_key     TEXT PRIMARY KEY,
  poster_url   TEXT,
  plot         TEXT,
  genre        TEXT,
  cast         TEXT,
  director     TEXT,
  duration_min INTEGER,
  trailer_id   TEXT,
  backdrop_url TEXT,
  rating       REAL,
  year         INTEGER,
  fetched_ms   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS episodes (
  key           TEXT PRIMARY KEY,
  series_key    TEXT NOT NULL,
  episode_id    TEXT NOT NULL,
  season        INTEGER NOT NULL,
  episode       INTEGER NOT NULL,
  title         TEXT NOT NULL,
  plot          TEXT,
  duration_min  INTEGER,
  container_ext TEXT,
  air_date      TEXT
);
CREATE INDEX IF NOT EXISTS idx_episodes_series ON episodes (series_key, season, episode);

-- Brugerens eget: hvad der er lagt til side, og hvor langt man er naaet.
CREATE TABLE IF NOT EXISTS vod_watchlist (
  item_key TEXT PRIMARY KEY,
  added_ms INTEGER NOT NULL
);

-- Plakater fundet hos TMDB til titler panelet ikke gav en. url er null
-- naar TMDB heller ikke kendte titlen; tried_ms siger hvornaar, saa den
-- ikke spoerges om igen med det samme.
CREATE TABLE IF NOT EXISTS vod_posters (
  item_key TEXT PRIMARY KEY,
  url      TEXT,
  rating   REAL,
  tried_ms INTEGER NOT NULL
);

-- Set faerdig: automatisk naar afspilningen naar slutningen, eller med et
-- tryk for det man har set andetsteds. Skilt fra fremdriften, som er "hvor
-- langt", ikke "faerdig".
CREATE TABLE IF NOT EXISTS vod_watched (
  item_key   TEXT PRIMARY KEY,
  watched_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS vod_progress (
  item_key   TEXT PRIMARY KEY,
  position_s INTEGER NOT NULL,
  duration_s INTEGER,
  updated_ms INTEGER NOT NULL
);
`;

const TABLES = [
  'sources',
  'categories',
  'channels',
  'favorites',
  'favorite_exclusions',
  'programmes',
  'epg_fetch',
  'epg_archive_fetch',
  'hidden_countries',
  'recordings',
  'registry_logos',
  'settings',
  'vod_categories',
  'vod_items',
  'vod_details',
  'episodes',
  'vod_watchlist',
  'vod_progress',
  'xmltv_logos',
  'logo_resolved',
  'logo_overrides',
  'logo_files',
  'logo_misses',
  'vod_posters',
  'vod_watched',
] as const;

// v8 tilfoejer VOD-tabellerne, v9 xmltv_logos, v10 logo_resolved og en
// kolonne paa vod_details. Tabellerne klarer `CREATE TABLE IF NOT EXISTS`;
// kolonnen har sit eget ALTER-trin.
// v11: logo_overrides. v12: logo_files og logo_misses. v13: favorites.position.
// v14: vod_posters. v15: vod_posters.rating. v16: vod_watched.
const SCHEMA_VERSION = 16;

/**
 * Foerste version der kan opgraderes additivt.
 *
 * v1 -> v2 aendrede betydningen af `programmes.channel_id` og formen paa
 * `favorites`, og maatte derfor bygges om. v2 -> v3 *tilfoejer* kun en tabel,
 * og `CREATE TABLE IF NOT EXISTS` klarer det alene — at slette brugerens
 * favoritter og hele programcachen for at tilfoeje en tom tabel ville vaere
 * skade uden formaal.
 */
const REBUILD_BELOW_VERSION = 2;

/**
 * Settings der overlever en genopbygning.
 *
 * `timeshift_dialect` er resultatet af en probing der **kun** koeres under
 * onboarding. Slettes den, mister en eksisterende installation start-forfra
 * permanent og uden nogen vej tilbage — stik imod formaalet med denne
 * migrering. `panel_offset_minutes` foelger med af samme grund.
 *
 * `last_sync_ms` bevares bevidst **ikke**: kanaler og EPG skal hentes paa ny
 * lige efter opgraderingen, ikke om et doegn.
 */
const PRESERVED_SETTINGS = ['timeshift_dialect', 'panel_offset_minutes'] as const;

interface FavoriteRow {
  channel_id: string;
}

interface SettingRow {
  key: string;
  value: string;
}

async function readUserVersion(db: SqlDatabase): Promise<number> {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const value = row?.user_version;
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/**
 * Laeser det brugeren selv har skabt ud af en aeldre database.
 *
 * Indpakket i sin egen fejlhaandtering: en beskadiget eller halvt migreret
 * v1-database maa ikke kunne blokere opgraderingen. Kan vi ikke laese
 * favoritterne, mister brugeren dem — men appen starter.
 */
async function readPreserved(
  db: SqlDatabase,
): Promise<{ favorites: string[]; settings: SettingRow[] }> {
  let favorites: string[] = [];
  let settings: SettingRow[] = [];

  try {
    const rows = await db.getAllAsync<FavoriteRow>('SELECT channel_id FROM favorites');
    favorites = rows.map((row) => row.channel_id).filter((id) => typeof id === 'string');
  } catch {
    // Tabellen fandtes ikke eller kunne ikke laeses.
  }

  try {
    const placeholders = PRESERVED_SETTINGS.map(() => '?').join(', ');
    settings = await db.getAllAsync<SettingRow>(
      `SELECT key, value FROM settings WHERE key IN (${placeholders})`,
      [...PRESERVED_SETTINGS],
    );
  } catch {
    // Som ovenfor.
  }

  return { favorites, settings };
}

async function restorePreserved(
  db: SqlDatabase,
  preserved: { favorites: string[]; settings: SettingRow[] },
): Promise<void> {
  for (const channelId of preserved.favorites) {
    // source_category_id er null: favoritten kom fra tiden foer kategori-
    // favoritter fandtes, saa den hoerer i favoritskaermens loese sektion.
    await db.runAsync(
      'INSERT OR IGNORE INTO favorites (channel_id, source_category_id) VALUES (?, NULL)',
      [channelId],
    );
  }
  for (const setting of preserved.settings) {
    await db.runAsync(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [setting.key, setting.value],
    );
  }
}

/**
 * Opretter skemaet, og opgraderer en v1-database ved at slette og genopbygge.
 *
 * `migrate()` kan ikke aendre eksisterende tabeller, og v2 aendrer baade
 * betydningen af `programmes.channel_id` og formen paa `favorites`. Databasen
 * indeholder ellers kun en cache af panelet, som hentes igen paa faa sekunder.
 * Det brugeren selv har skabt — favoritter — og det der ikke kan genskabes
 * uden onboarding — timeshift-dialekten — loeftes med over.
 */
/**
 * v5 tilfoejer en kilde til kanaler og kategorier.
 *
 * Kolonnerne skal ind **foer** skemaet koeres: skemaet laegger et indeks paa
 * `channels.source_id`, og det kan ikke oprettes paa en tabel hvor kolonnen
 * ikke findes endnu.
 *
 * `CREATE TABLE IF NOT EXISTS` kan ikke tilfoeje kolonner til en tabel der
 * allerede findes, saa det maa vaere ALTER.
 */
async function addV5Columns(db: SqlDatabase): Promise<void> {
  const additions = [
    "ALTER TABLE channels ADD COLUMN source_id TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE channels ADD COLUMN stream_id TEXT NOT NULL DEFAULT ''",
    'ALTER TABLE channels ADD COLUMN stream_url TEXT',
    "ALTER TABLE categories ADD COLUMN source_id TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE channels ADD COLUMN match_key TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE channels ADD COLUMN country TEXT NOT NULL DEFAULT ''",
  ];
  for (const sql of additions) {
    try {
      await db.execAsync(sql);
    } catch {
      // Kolonnen fandtes allerede. Migreringen skal kunne koere igen paa en
      // database der naaede halvvejs foer appen blev lukket.
    }
  }
}

/** v10: plakaten som opslaget oplyser den, ved siden af listens. */
async function addV10Columns(db: SqlDatabase): Promise<void> {
  try {
    await db.execAsync('ALTER TABLE vod_details ADD COLUMN poster_url TEXT');
  } catch {
    // Kolonnen fandtes allerede.
  }
}

/**
 * v13: favoritternes egen raekkefoelge.
 *
 * De der allerede er favoritter, faar numre i den orden de stod i: kategorier
 * foerst i panelets orden, saa de enkeltvis valgte. Det er den orden skaermen
 * viste foer, saa ingen oplever at listen bytter rundt ved opdateringen.
 */
async function addV13Columns(db: SqlDatabase): Promise<void> {
  try {
    await db.execAsync('ALTER TABLE favorites ADD COLUMN position INTEGER');
  } catch {
    // Kolonnen fandtes allerede.
  }
  const rows = await db.getAllAsync<{ channel_id: string }>(
    `SELECT f.channel_id
     FROM favorites f
     LEFT JOIN channels c ON c.id = f.channel_id
     WHERE f.position IS NULL
     ORDER BY CASE WHEN f.source_category_id IS NULL THEN 1 ELSE 0 END,
              COALESCE(c.sort_order, 0), f.rowid`,
  );
  const start = await db.getFirstAsync<{ n: number | null }>('SELECT MAX(position) AS n FROM favorites');
  let position = (start?.n ?? -1) + 1;
  for (const row of rows) {
    await db.runAsync('UPDATE favorites SET position = ? WHERE channel_id = ?', [position, row.channel_id]);
    position += 1;
  }
}

/** v15: karakteren fra TMDB ved siden af plakaten. */
async function addV15Columns(db: SqlDatabase): Promise<void> {
  try {
    await db.execAsync('ALTER TABLE vod_posters ADD COLUMN rating REAL');
  } catch {
    // Kolonnen fandtes allerede.
  }
}

/**
 * Rydder den cache hvis id'er skifter betydning ved v5.
 *
 * Kanalens id gaar fra at vaere panelets eget til ogsaa at sige hvorfra. En
 * halv cache med gamle noegler ville se rigtig ud og pege forkert.
 *
 * Koeres **efter** skemaet: en aeldre database mangler nogle af tabellerne,
 * og et DELETE fra en tabel der ikke findes stopper migreringen.
 *
 * Favoritter, optagelser og skjulte lande roeres ikke. De er brugerens eget
 * arbejde, og de faar deres nye noegle naar appen ved hvilken kilde de hoerer
 * til; det ved den foerst naar adgangsoplysningerne er laest, og de ligger i
 * Keychain, ikke i databasen.
 */
async function clearV5Cache(db: SqlDatabase): Promise<void> {
  for (const table of [
    'channels',
    'categories',
    'programmes',
    'epg_fetch',
    'epg_archive_fetch',
  ]) {
    await db.execAsync(`DELETE FROM ${table}`);
  }
  // Uden dette springes kanal-synken over i et doegn, og appen ville staa med
  // en tom liste den ikke selv fyldte op igen.
  await db.execAsync("DELETE FROM settings WHERE key = 'last_sync_ms'");
}

/**
 * Faar kanalerne hentet igen ved naeste opstart.
 *
 * Baade den faelles noegle og kildernes egne — `last_sync_ms:<kilde>`. Kun
 * hentetiden: favoritter, optagelser og skjulte lande er brugerens eget
 * arbejde og roeres ikke.
 */
async function clearSyncTimes(db: SqlDatabase): Promise<void> {
  await db.execAsync(
    "DELETE FROM settings WHERE key = 'last_sync_ms' OR key LIKE 'last_sync_ms:%'",
  );
}

export async function migrate(db: SqlDatabase): Promise<void> {
  const version = await readUserVersion(db);

  if (version > 0 && version < REBUILD_BELOW_VERSION) {
    const preserved = await readPreserved(db);
    for (const table of TABLES) {
      await db.execAsync(`DROP TABLE IF EXISTS ${table}`);
    }
    await db.execAsync(SCHEMA);
    await restorePreserved(db, preserved);
  } else {
    // v6 tilfoejer to kolonner mere til channels; samme ALTER-trin klarer
    // begge spring, og cachen ryddes alligevel.
    const toV5 = version >= REBUILD_BELOW_VERSION && version < 6;
    if (toV5) await addV5Columns(db);
    await db.execAsync(SCHEMA);
    if (toV5) await clearV5Cache(db);
    // Efter skemaet: paa en frisk database har CREATE TABLE allerede kolonnen
    // med, og ALTER-trinnet svarer bare at den findes.
    if (version >= 8 && version < 10) await addV10Columns(db);
    if (version > 0 && version < 13) await addV13Columns(db);
    if (version === 14) await addV15Columns(db);

  }

  await db.execAsync(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  await refreshChannelsWhenMatchRulesChanged(db);
}

/**
 * Faar kanalerne hentet igen naar reglerne for `channels.match_key` er
 * aendret.
 *
 * Noeglen regnes ud naar kanalerne hentes og ligger gemt i raekken. Aendres
 * reglerne — og det goer de, hver gang et nyt navnemoenster dukker op — staar
 * telefonen med noegler efter de gamle regler og et register efter de nye, og
 * logoer der virkede i gaar er vaek indtil den daglige hentning. Det skete
 * med TV3+.
 *
 * Foer laa det som et skema-trin (v7), som skulle huskes hver gang. Nu er det
 * et tal i core, ved siden af reglerne det gaelder for, og det her sted
 * sammenligner. Ingen tabeller aendres; kun hentetiden nulstilles.
 */
async function refreshChannelsWhenMatchRulesChanged(db: SqlDatabase): Promise<void> {
  const row = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM settings WHERE key = 'match_key_version'",
  );
  if (row?.value === String(MATCH_KEY_VERSION)) return;
  await clearSyncTimes(db);
  await db.runAsync(
    `INSERT INTO settings (key, value) VALUES ('match_key_version', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [String(MATCH_KEY_VERSION)],
  );
}

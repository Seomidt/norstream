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
  source_category_id TEXT
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
] as const;

const SCHEMA_VERSION = 7;

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

    // v7 aendrer **ingen tabeller** — den aendrer hvordan `channels.match_key`
    // regnes ud (plus bevares, landenavne fjernes). Noeglen ligger gemt i
    // raekken, saa en database fra v6 baerer den gamle udregning rundt indtil
    // kanalerne hentes igen — og det sker foerst om et doegn. Hentetiden
    // nulstilles, saa opslaget passer med det samme.
    if (version >= REBUILD_BELOW_VERSION && version < 7) await clearSyncTimes(db);
  }

  await db.execAsync(`PRAGMA user_version = ${SCHEMA_VERSION}`);
}

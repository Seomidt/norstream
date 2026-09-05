# NorStream — Plan 1: EPG og guide

**Goal:** Erstat XMLTV-vejen med `get_short_epg` per kanal, giv EPG'en en cache
med tre fornyelsesregler, migrér skemaet til v2 uden at miste favoritter, læs
panelets tidszone-offset fra `server_info`, og byg en guide-skærm hvor
start-forfra får et synligt hjem.

**Spec:** `docs/superpowers/specs/2026-09-05-navigation-og-epg-design.md`
(afsnit 2, 4, 8, 9). Spec'ens afsnit 5, 6 og 7 hører til Plan 2.

**Arkitektur:** Al panel-oversættelse — base64, epoch-sekunder, tolerance over
for beskadigede felter — ligger i `packages/core`, så den testes ét sted uden
emulator. Appen ejer cache-reglerne, skemaet og skærmene.

---

## Globale constraints

Uændret fra core-planen, gentaget fordi de er blevet brudt før:

- `packages/core` må ikke importere React Native, `react` eller Node-moduler.
  CI håndhæver det med grep. `tsconfig` har `lib: ["ES2022"]` uden `DOM`.
- Ingen runtime-dependencies i `core`.
- Parsere kaster aldrig på malformet input; et ugyldigt element springes over.
- Alle tidsstempler i databasen er epoch-millisekunder i `INTEGER`-kolonner.
- **Tests må ikke bruge vægururet.** Hver funktion der har brug for "nu" tager
  et eksplicit `now: Date`. Fem tests bestod den ene dag og fejlede den næste,
  fordi denne regel blev brudt.
- Test-fixtures indeholder aldrig rigtige credentials: `http://panel.example:8080`,
  `USER`, `PASS`.

---

## Afvigelser fra spec'en, og hvorfor

Tre steder holder spec'en ikke ved kontakt med koden. De er afgjort her frem
for i implementeringen, så beslutningen står ét sted.

### 1. Base64 afkodes med en egen implementering, ikke `atob`

Spec'en siger blot "base64-afkodet". `atob` findes ikke i `lib: ["ES2022"]`, og
den returnerer latin1-bytes: en dansk programtitel med `æøå` ville komme ud som
mojibake. `TextDecoder` er heller ikke i ES2022-lib'en og ville kræve `DOM`.

**Afgjort:** `packages/core/src/base64.ts` afkoder base64 → bytes → UTF-8 i ren
TypeScript. ~60 linjer, ingen afhængigheder, samme opførsel i Node og Hermes.
Ugyldig base64 og ugyldig UTF-8 giver `null`, ikke en exception.

### 2. Cache-regel 1 er "der er ikke hentet", ikke "der er ingen programmer"

Spec afsnit 4 skriver regel 1 som "Der findes ingen data for kanalen". Læses
det som "ingen rækker i `programmes`", henter appen igen ved **hver** rendering
for enhver kanal panelet ikke har EPG for — præcis den stormløb cachen findes
for at forhindre.

**Afgjort:** regel 1 er `epg_fetch.fetched_at IS NULL`. Et vellykket kald der
gav nul programmer sætter alligevel `fetched_at`, så regel 2 (30 minutter)
dækker kanalen bagefter. Regel 3 kan ikke udløses uden data og springes over
når der ingen er.

### 3. Migreringen bevarer også `settings`, ikke kun favoritter

Spec afsnit 9 siger at databasen slettes og genopbygges, og at favoritter
bevares fordi de er "det eneste den lokale database indeholder som brugeren
selv har skabt". Det overser at `settings` rummer `timeshift_dialect` —
resultatet af en probing der **kun** køres under onboarding. Slettes den, mister
en eksisterende installation start-forfra permanent, uden nogen vej til at få
det tilbage. Det er stik imod planens eget formål.

**Afgjort:** `timeshift_dialect` og `panel_offset_minutes` bevares hen over
migreringen sammen med favoritterne. `last_sync_ms` bevares **ikke**, så
kanaler og EPG hentes på ny som spec'en beskriver.

---

## Filstruktur

| Fil | Ansvar |
|---|---|
| `packages/core/src/base64.ts` | Base64 → UTF-8, uden afhængigheder |
| `packages/core/src/xtream/shortEpg.ts` | `get_short_epg`-svar → `Programme[]` |
| `packages/core/src/xtream/serverInfo.ts` | `server_info` → panel-offset i minutter |
| `packages/core/src/xtream/client.ts` | + `getShortEpg`, `getServerInfo` |
| `packages/app/src/storage/schema.ts` | Skema v2 + migrering med bevaring |
| `packages/app/src/storage/epgFetch.ts` | `fetched_at` per stream_id |
| `packages/app/src/sync/epgCache.ts` | De tre fornyelsesregler + bounded hentning |
| `packages/app/src/features/guide/GuideScreen.tsx` | Tidsgitteret |
| `packages/app/src/sync/syncEpg.ts` | **Slettes** — XMLTV-vejen udgår |

---

### Task 1: Base64 til UTF-8 i core

**Files:** create `packages/core/src/base64.ts`, `packages/core/src/base64.test.ts`

**Produces:** `decodeBase64Utf8(value: string): string | null`

- [ ] Afkod standard-alfabetet plus URL-varianten (`-`/`_`), ignorér whitespace
- [ ] Accepter både korrekt og manglende `=`-padding
- [ ] Returnér `null` ved ugyldigt tegn, ugyldig længde (rest 1) eller ugyldig UTF-8
- [ ] Afkod UTF-8 korrekt for 1-, 2-, 3- og 4-byte sekvenser; afvis overlange
      sekvenser og løse surrogater
- [ ] Tests: ASCII, `æøå`, emoji, tom streng (→ `''`), whitespace, ugyldigt tegn,
      manglende padding, afkortet multibyte-sekvens

### Task 2: `get_short_epg`-oversættelse i core

**Files:** create `packages/core/src/xtream/shortEpg.ts` + test

**Consumes:** `decodeBase64Utf8`, `Programme`, `toInteger`
**Produces:** `mapShortEpg(raw: unknown): Programme[]`, `RawShortEpgListing`

- [ ] Accepter både `{ epg_listings: [...] }` og et bart array
- [ ] `channelId` sættes af kalderen (svaret bærer ikke stream_id pålideligt) —
      `mapShortEpg` tager `streamId` som første argument
- [ ] `start_timestamp`/`stop_timestamp` er epoch-**sekunder**, som tal eller
      streng. `end_timestamp` accepteres som alias for `stop_timestamp`
- [ ] Spring poster over uden titel, uden tidsstempler, eller hvor `stop <= start`
- [ ] Kaster aldrig

### Task 3: `getShortEpg` og `getServerInfo` på klienten

**Files:** modify `packages/core/src/xtream/client.ts`, `serverInfo.ts` (ny),
`index.ts`, tests

**Produces:**
- `XtreamClient.getShortEpg(streamId: string, limit?: number): Promise<Programme[]>`
- `XtreamClient.getServerInfo(): Promise<{ offsetMinutes: number | null }>`
- `panelOffsetFromServerInfo(raw: unknown): number | null`

- [ ] `endpoint()` udvides med ekstra query-parametre uden at ændre eksisterende kald
- [ ] `getShortEpg` bruger `request`, ikke `requestList`: svaret er et **objekt**
- [ ] Panelets offset udledes af `server_info.time_now` (`"YYYY-MM-DD HH:MM:SS"`,
      panelets lokale tid) minus `server_info.timestamp_now` (epoch-sekunder).
      **`timezone`-strengen fortolkes ikke** — det ville kræve `Intl` med
      vilkårlig IANA-zone, som Hermes ikke leverer pålideligt. Mangler et af
      felterne, returneres `null` og appen beholder 0; `detectTimeshiftDialect`
      prober allerede ±13 timer og overlever et forkert offset
- [ ] Resultatet rundes til nærmeste 15 minutter og klampes til ±14 timer
- [ ] Tests: 401 → `XtreamAuthError`, HTTP 500 → `XtreamNetworkError`,
      ikke-JSON → `XtreamNetworkError`, tomt svar → `[]`, korrekt URL med `limit`

### Task 4: Skema v2 med bevarende migrering

**Files:** modify `packages/app/src/storage/schema.ts`, test

- [ ] `programmes.channel_id` dokumenteres som Xtreams `stream_id`
- [ ] Ny tabel `epg_fetch (stream_id TEXT PRIMARY KEY, fetched_at INTEGER NOT NULL)`
- [ ] `favorites` får `source_category_id TEXT`
- [ ] Ny tabel `hidden_countries (name TEXT PRIMARY KEY)`
- [ ] `SCHEMA_VERSION = 2`
- [ ] `migrate()`: læs `PRAGMA user_version`.
      `0` → frisk installation, opret kun.
      `1` → læs favoritter og de to bevarede settings-nøgler, `DROP` alle
      tabeller, opret på ny, skriv dem tilbage.
      `>= 2` → `CREATE IF NOT EXISTS`, ingen sletning.
- [ ] Læsningen af de gamle data er indpakket: en beskadiget v1-database må
      ikke kunne blokere opgraderingen
- [ ] Tests: frisk database; v1 med favoritter og dialekt → begge overlever,
      `last_sync_ms` gør ikke; migrering to gange i træk er idempotent

### Task 5: `epg_fetch`-laget

**Files:** create `packages/app/src/storage/epgFetch.ts` + test

**Produces:** `getEpgFreshness(db, streamId, now)`, `markEpgFetched(db, streamId, now)`,
`needsEpgFetch(freshness, now)`

- [ ] Ét opslag med to skalar-subqueries henter `fetched_at` og `MAX(stop_ms)`
- [ ] `needsEpgFetch` er ren og tager `now` — den er reglen, og den testes alene
- [ ] Tests dækker hver af de tre regler hver for sig, og det tilfælde hvor
      ingen af dem gælder

### Task 6: EPG-cachen

**Files:** create `packages/app/src/sync/epgCache.ts` + test;
delete `packages/app/src/sync/syncEpg.ts` og dens test

- [ ] `ensureEpg(db, creds, fetchImpl, streamIds, now, opts?)` henter kun for de
      kanaler `needsEpgFetch` peger på
- [ ] Højst 4 kald i luften ad gangen. Panelets `max_connections: 1` gælder
      streams, ikke `player_api.php`, men en ubegrænset fan-out over en synlig
      guide-side ville stadig være uartig
- [ ] `XtreamAuthError` kastes videre — appen skal kunne logge brugeren ud.
      Alle andre fejl per kanal sluges, så én død kanal ikke tager resten
- [ ] Rydning: programmer der sluttede for mere end 12 timer siden slettes, og
      kun hvis mindst ét program blev hentet
- [ ] Tests: cache-hit henter ikke; udløbet `fetched_at` henter; afsluttet
      program henter; parallelitet overstiger aldrig 4; auth-fejl kastes videre;
      netværksfejl på én kanal stopper ikke de øvrige

### Task 7: EPG-opslag på stream_id i skærmene

**Files:** modify `ChannelListScreen.tsx`, `PlayerScreen.tsx`

- [ ] `getNowNext(db, channel.id, now)` — ikke `channel.epgChannelId`.
      Det er hele pointen i afsnit 2: 87 % af kanalerne har intet EPG-id
- [ ] Kanallisten kalder `ensureEpg` for de kanaler den faktisk viser
- [ ] `syncFromPanel` deler ikke længere tæller med EPG — den henter kun kanaler

### Task 8: Panelets offset gemmes ved onboarding

**Files:** modify `OnboardingScreen.tsx`

- [ ] `getServerInfo()` kaldes i samme tolerante blok som dialekt-probingen
- [ ] Er offsettet `null`, skrives ingenting, og de gemte 0 minutter består

### Task 9: Guide-skærmen

**Files:** create `packages/app/src/features/guide/GuideScreen.tsx`,
`packages/app/src/features/guide/layout.ts` + test

**Produces:** `layoutRow(programmes, windowStart, windowEnd, now)` → celler med
`flex`-vægt og tilstand (`live` | `past` | `future` | `gap`)

- [ ] **Ingen vandret scroll.** Gitteret er præcis skærmbredt og viser et vindue
      på to timer, der pages med ‹ og ›. Alternativet — vandret scroll med en
      fastlåst kanalkolonne — kræver at to lodrette lister holdes synkroniseret
      manuelt, og betaler for det med en fejlkilde guiden ikke har brug for
- [ ] Kanalkolonnen ligger fast til venstre; rækkerne er en lodret `FlatList`,
      så 979 kanaler i Danmark stadig virtualiseres
- [ ] Celler får bredde efter deres andel af vinduet, klippet til vinduets kanter
- [ ] Huller i EPG'en bliver til en dæmpet celle, ikke et sammenfald
- [ ] Kun synlige rækker henter: `onViewableItemsChanged` → `ensureEpg`
- [ ] Tryk følger spec'ens tabel: sendes nu → afspil; slut + arkiv + dialekt →
      start forfra; slut uden arkiv → inaktiv; kommer senere → inaktiv
- [ ] `layout.ts` er ren og testes uden at rendere: klipning i begge ender,
      program der spænder hele vinduet, tomt vindue, hul mellem to programmer

### Task 10: Start-forfra fra guiden

**Files:** modify `PlayerScreen.tsx`

- [ ] Ny prop `startFrom?: Programme`. Er den sat, bygges timeshift-URL'en så
      snart dialekt og offset er læst, og `restarted` sættes med det samme
- [ ] Format-fallback springes over under start-forfra, som i dag: timeshift-URL'en
      er altid HLS

# NorStream — overdragelse

**Dato:** 2026-09-05
**Til:** næste session, eller enhver der samler projektet op

Dette dokument er udgangspunktet. Alt andet i `docs/` er detaljer; dette er hvad du skal vide først.

---

## Hvad projektet er

En IPTV-app med Norlys Play-agtig brugsoplevelse, der henter indhold fra brugerens eget Xtream Codes-panel. Bygget i en npm-monorepo:

- **`packages/core`** — platform-uafhængigt TypeScript-bibliotek. M3U-parsing, Xtream-klient, `get_short_epg`-oversættelse, base64, landeudledning, URL-byggere. **153 tests.** Ingen runtime-afhængigheder, ingen React Native-imports. CI håndhæver begge dele.
- **`packages/app`** — Expo SDK 57-app (React Native 0.86). **145 tests.**

**Repo:** https://github.com/Seomidt/norstream (privat).

## Status

**12. september 2026.** Appen kører på brugerens Google TV Streamer og
telefon mod det rigtige panel, og brugerens ord er "nu er det hele
efterhånden som det skal være". Alt bygges via GitHub, aldrig EAS; se
`docs/BYG-FRA-CHAT.md`.

### 17.–18. september 2026 — selv-opdatering, sky-backup, tv-rettelser (LÆS DENNE FØRST)

Nyeste udgave: **versionCode 249** (tv og telefon), udgivet i skyen. Udgaver
nummereres nu med `expo.android.versionCode` i `packages/app/app.json` — **hæv
det ved hver ny udgave**, ellers kan boksen ikke se at der er kommet en ny.

**Ny boks = kun ét kodeord (v239).** På login-skærmen er der nu en tredje fane
**"Sky-kopi"**: skriv kodeordet → appen henter kopien, logger selv på panelet
og henter grupper, favoritter og alt. Muligt fordi sky-kopien nu (krypteret)
også rummer **panel-kodeordet** (backup-skema v2, `password` på kilderne, kun
med når `loadCreds` gives med til `createBackup` — altså kun i den krypterede
sky-kopi, aldrig i en kopi der kan ende i klartekst). Onboarding genbruger
`connectXtream`/`connectM3u` (login + kanalhentning) og kører derefter
`restoreBackup`. Se `features/onboarding/OnboardingScreen.tsx` →
`restoreFromSky`.

**1:1 kopi også til en ANDEN fil (v240).** Backup-skema **v3** gemmer nu
`channelNames` (navnet på hver kanal favoritter/grupper/logoer peger på).
`restoreBackup(db, backup, { matchByName: true })` finder de samme kanaler igen
på **navn** (`normaliseChannelName`) når panelet er et andet og id'erne ikke
passer — så favoritter, grupper og egne logoer følger med til et nyt panel med
samme kanaler. Begge gendan-veje (onboarding "Sky-kopi" og Indstillinger →
"Hent fra skyen") sender `matchByName: true`. Samme panel bruger stadig
id-match (præcist); navne-match er kun reserven. **Brug for en anden fil?** Log
ind på den nye fil under "Panel", gå så til Indstillinger → Gem i skyen → Hent.
Kategorier og VOD-fremdrift kan ikke navne-matches (springes over på en anden
fil).

**"Forfra" bliver ikke til sort skærm midt i udsendelsen (v249).** Bruger:
"far var ved at se en udsendelse på dansk TV 2 forfra, men den stoppede inden
udsendelsen var færdig — bare sort skærm." Årsag: "Start forfra" genstarter den
udsendelse der sendes **nu**, og arkiv-adressen beder om hele udsendelsens
længde (`programme.stop − programme.start`). Men arkivet findes kun frem til
"nu" (den levende kant). Når afspilningen indhenter det, melder expo-video
`playToEnd`, og billedet stod sort på sidste billede midt i udsendelsen. Fix i
`features/player/PlayerScreen.tsx`: en ny `playToEnd`-lytter — sender
udsendelsen **stadig** (referencens `stop` er i fremtiden), skifter appen til
live-streamen, så resten ses direkte (badge: "Du er nået til direkte — ser
resten live"). Er programmet rigtigt slut (et afsluttet program åbnet fra
guiden, `stop` i fortiden), røres intet — arkivet sluttede fordi udsendelsen
sluttede. **Bemærk:** hjælper kun når panelet melder en egentlig slutning
(ENDLIST). Stopper det i stedet som en fastfrysning/stall ved kanten, fanges
det af stall-timeren (`STALL_TIMEOUT_MS` → genforbind); melder brugeren stadig
sort skærm, er næste skridt at lade `handleFailure` også falde til live under
en igangværende forfra.

**Guiden springer ikke længere til toppen (v248).** Bruger: "når jeg når
halvvejs ned i guiden springer den pludselig til toppen." Årsag: en række
længere nede stod tom (dens programdata var ikke hentet endnu), og landede
dataene mens fjernbetjeningen stod på den, skiftede cellen fra "Ingen
programdata" til rigtige udsendelses-celler — den fokuserede celle forsvandt,
og gitterets `autoFocus` faldt tilbage til øverste række. Fix i
`features/guide/GuideScreen.tsx`: en ny baggrunds-effekt henter **alle**
favoritters fulde programdata så snart listen er læst (`ensureFullEpg` over
hele `channels`), så cellerne er fyldt inden man ruller ned til dem — så sker
det skift-under-fokus ikke. `ensureFullEpg` springer selv de friske kanaler
over (freshness-gated), så det koster kun det der mangler, og det blokerer ikke
de synlige hentninger. Kun én gang per liste (`prefetchedList`-ref). Samme
rettelse hjælper også på "svær at blive stående på det kanal sender nu", fordi
"nu"-cellen nu er der på forhånd. **Åbent punkt:** hjælper det ikke helt, er
næste skridt at se på selve gitterets `autoFocus`-adfærd direkte (fastholde
fokus på række-indeks i stedet for celle-identitet).

**Logo-søgning kun til favoritter (v247).** "Kanaler uden logo" hed før og
søgte over ALLE kanaler (op til 2000). Nu er skærmen "Favoritter uden logo" og
både listen og den automatiske net-søgning er scopet til favoritter
(`listChannelsWithoutArchiveLogo(db, { favouritesOnly: true })` — nyt option i
`storage/logoOverrides.ts`; brugt begge steder i `LogoGapsScreen`). Hurtigere og
kun det relevante. **Åbent punkt:** brugeren synes stadig mange danske kanaler
mangler et logo der burde kunne findes — logo-matchningen (`sync/logoSearch.ts`,
Wikidata `wbsearchentities` på `searchNameFor(navn)` i landets sprog) skal
tunes; afventer et skærmbillede af de kanaler der fejler, så navnene kan ses.

**"Dine kanaler nu" skjules når man har grupper (v246).** Forsidens
favorit-række ("Dine kanaler nu", alle favoritter) var en dublet af
gruppe-rækkerne for en bruger der organiserer i grupper. Nu vises den kun når
brugeren **ikke** har nogen grupper (`features/home/FrontScreen.tsx`: ny
`hasGroups`-state fra `listFavoriteGroups`, og `if (!hasGroups) rows.push({
kind: 'favourites' })`). Baseret på OM der er grupper, ikke om de sender noget
lige nu, så rækken ikke blinker frem. Sletter man alle grupper, kommer den
igen som forsidens nu-overblik.

**To manglende SQLite-indeks (v245).** Efter en ren hastigheds-audit af hele
appen: to hotte forespørgsler sorterede hele tabellen i en temp-tabel, fordi
der manglede et indeks. Tilføjet i `storage/schema.ts` (begge `IF NOT EXISTS`,
så de laves automatisk ved næste opstart — ingen version-bump, ingen migrering):
- `idx_vod_items_newest (kind, added_ms)` — "Nyeste film/serier" på forsiden
  (`vod.ts` `ORDER BY added_ms DESC LIMIT`) sorterede før tusinder hver gang.
- `idx_channels_cat_order (category_id, sort_order)` — både kategori-listen
  (`channels.ts`) og `countriesFromChannels`-vinduet over alle 22k kanaler.
Auditten bekræftede resten er sund (EPG/logo-cache, radio-indeks, programmes-
indeks). **Bevidst udeladt** (medium værdi, større risiko på forsiden): fuld
memoisering af FrontScreen-hylderne, `getItemLayout` på Kanaler (kræver
verificeret fast rækkehøjde), dedup af kategori-opslag ved land-skift (indekset
ovenfor dækker det meste), og batch af "nu"-titler på forsiden.

**Kanaler føles hurtig igen (v244).** Bruger meldte at Kanaler var tung på tv
og "læste alt to gange". To ting i `features/channels/ChannelList.tsx`:
- **Rækken er nu `memo`'et** (`ChannelRow`), og `renderItem` er `useCallback`
  der **bevidst IKKE afhænger af `previewChannel`**. Før tegnede hele den
  synlige liste sig om ved hvert D-pad-tryk (fokus → `setPreviewChannel` →
  forælder tegnes om → inline `renderItem` → alle rækker, inkl. logoer). Nu
  tegnes kun de rækker om hvis nu-titel/ur/fokus-puls skifter. Tilbagekaldene
  (`handleOpen` via `shownRef`, `handleFocusRow`, `handleToggleFavorite`) er
  stabile.
- **Dobbelt-load fjernet:** første-skærm-effekten afhang af `dialects`, som
  lander lige efter monteringen — så den hentede alle nu-titler forfra én gang
  til ("læser alt to gange"). Nu `[channels, restartOnly]`.
- `shown`/`restartable` er `useMemo` (filtrene løb før ved hver tegning).

**Fuld audit-runde (v243).** Efter en read-only gennemgang af hele
kodebasen (fokus/hastighed/caching): tre lister mere satte
`removeClippedSubviews` **true** og er D-pad-lister på tv — nu `{!isTV}`
(`ui/RememberedList.tsx` = alle radiolister, `features/vod/VodScreen.tsx`
plakat-gitteret, `features/home/FrontScreen.tsx` forsidens rækker+hylder).
`ChannelList` skiftet fra `{false}` til `{!isTV}` så telefonen beholder
klipningen på 22k-listen. **N+1 fjernet:** `storage/radio.ts`
`countRadioStationsByCountry` lavede før ét `SELECT`+sortering **per land** —
nu ét opslag + gruppering i hukommelsen. Auditten bekræftede at caching
allerede er solid (`epgCache`, `logoCache` bruges overalt, ingen bypass) og at
`disabled`-fælden er lukket centralt. Kendte, bevidst udeladte små ting
(lav værdi/risiko): `listRecentChannels`/`listFollowedSeries` N+1 (≤10 PK-opslag
på forsiden), TMDB-plakater uden fil-cache, og `ChannelList` der gentegner hele
listen ved hvert D-pad-tryk (kræver memo-refaktor af rækken — tages hvis D-pad
føles tungt).

**Fokus-gennemgang af HELE appen (v242).** To systemiske tv-fokusfælder
rettet ét sted hver:
- **`disabled` er en fælde på tv** (en deaktiveret Pressable kan ikke få fokus,
  så en knap der deaktiverer sig selv når man trykker — "Gemmer …", "Opdaterer
  …" — sender fokus ud i menuen). Rettet **centralt i `ui/TvPressable.tsx`**:
  på tv sendes `disabled` ikke til den native Pressable; knappen bliver
  fokuserbar, trykket bliver bare uden virkning, og den tones ned (opacity
  0.4). På telefon er `disabled` uændret. Fixer alle steder på én gang
  (Indstillinger opdatér/hent, Kilder, Onboarding, Forbindelsestjek, Player…).
- **Lister der afmonterer den fokuserede række ved kanten.** `FlatList` på
  Android afmonterer klippede rækker som standard; står fjernbetjeningen på en,
  ryger fokus. Sat `removeClippedSubviews={false}` på alle D-pad-lister:
  `ChannelList` (Kanaler, 22k — `windowSize={5}` bounder alligevel),
  BrowseScreen, CinemaScreen, ChannelDayScreen, GroupsScreen, LogoGaps,
  LogoPicker, TrackPicker, SavedSongs (+ guiden i v241).
Gennemgået `hasTVPreferredFocus` i hele appen: alle per-række er gated
(`index === 0` eller en engangs-puls); `={isTV}` er enkeltknapper der tager
fokus når de dukker op (bevidst).

**Guide-fokus holder nu fast (v241).** I guiden kunne fokus springe **ud i
menuen til venstre**, når den celle fjernbetjeningen stod på blev skiftet ud
(rækken fik programdata, eller 2-timers-vinduet flyttede sig). To rettelser i
`GuideScreen.tsx`: gitterets indre `TVFocusGuideView` har nu `autoFocus`
(trækker fokus tilbage i gitteret i stedet for ud i menuen), og `FlatList` har
`removeClippedSubviews={false}` (så en række fjernbetjeningen står på aldrig
afmonteres ved kanten). De gamle værn (`recoverKey`, `focusTarget`, trap
left/right/up) er bevaret. Gennemgået for andre fælder: intet `disabled` på
tv-fokusérbare knapper, logoet er `focusable={!isTV}`, `hasTVPreferredFocus` er
dynamisk (aldrig statisk sand).

**YouTube-trailer og bot-tjek (v240).** YouTube er begyndt at spærre den
indlejrede afspiller i webvisninger ("Log ind for at bekræfte, at du ikke er en
bot"). `TrailerScreen` sætter nu en rigtig Chrome-`userAgent` +
`thirdPartyCookiesEnabled`/`sharedCookiesEnabled` for at ramme tjekket
sjældnere. Det er **ikke** en garanti — tjekket sidder også på YouTubes side —
og "Åbn i YouTube" (åbner YouTube-appen) er stadig den sikre vej.

**Appen opdaterer sig selv, uden Play Store.**
- `build-android.yml` (`motor: runner`) bygger APK'erne (uændret).
- **`.github/workflows/udgiv-apk.yml`** ligger på **main** (merget via PR #3)
  og lægger en færdig byg-kørsels APK op som en offentlig GitHub-udgivelse med
  et fast mærkat: `latest-norstream` (telefon), `latest-norstream-tv` (tv),
  `latest-norradio`. Udgivelsens note = versionsnummeret. Samme fil
  (`--clobber`) hver gang, så der kun er én `.apk` per mærkat, og den gamle
  bliver stående hvis et trin fejler.
- Appen læser mærkatet (`features/settings/appUpdate.ts` +
  `appUpdateParse.ts`), sammenligner med sit eget versionCode, henter APK'en
  og starter Androids installation. **Tv tjekker selv ved hver opstart**
  (`features/settings/autoUpdate.ts`, kaldt fra `App.tsx`); telefonen har
  knappen i Indstillinger → Opdatering, hvor udgaven også vises stort.
- **Sådan udgiver en ny chat en opdatering:** hæv versionCode i `app.json`,
  push, start `build-android.yml` (GitHub-værktøjet, `motor: runner`, `tv`
  true/false), notér byg-kørslens run-id, og start `udgiv-apk.yml` på **main**
  med `{run_id, variant: norstream|norstream-tv|norradio, version: <versionCode>}`.
  Fuld opskrift i `docs/BYG-FRA-CHAT.md` afsnit 9.
- **Hvorfor to workflows:** en *ændret* `build-android.yml` bliver sat i
  "afventer godkendelse" (action_required) når den startes med
  workflow_dispatch, så udgiv-trinnet måtte ligge i sin egen fil på main.
  Sessionens egne pushes udløser ikke selv workflows; kør dem med
  GitHub-værktøjet (workflow_dispatch). Telefon-uploaden af den ~100 MB store
  APK kan tage flere minutter — vent på at udgiv-kørslen er `completed`.

**Sikkerhedskopi: sky med kodeord (INGEN Google, INGEN login).**
- Google Drev-vejen er **fjernet** (den krævede at brugeren selv udgav en
  OAuth-samtykkeskærm i Google Cloud Console — det kunne han ikke få til at
  virke, og "Publish app" var grået ud). De endnu ældre veje (mappe, USB,
  Gendan fra link, direkte telefon↔tv) blev fjernet før det. Nu står kun
  **"Gem i skyen"** tilbage i Indstillinger (`features/settings/CloudBackup.tsx`).
- **Sådan virker det:** brugeren vælger ét **kodeord**. Appen sender kopien +
  kodeordet til en lille **Supabase edge-funktion** (`sky`) i brugerens eget
  projekt (**"Seomidt's Project"**, ref `usewnyvdxxfgvwaefvmq`). Funktionen
  **krypterer** kopien med en nøgle udledt af kodeordet (PBKDF2 + AES-GCM) og
  gemmer den under en **hash af kodeordet**. Samme kodeord på en ny boks →
  "Hent" → alt er tilbage. **Ingen login, ingen enhedskode, ingen Google.**
- **Hvor tingene ligger:**
  - App-klient: `features/settings/cloudSync.ts` (`saveToCloud`,
    `loadFromCloud`) — to `fetch`-kald mod
    `https://usewnyvdxxfgvwaefvmq.supabase.co/functions/v1/sky`. URL + den
    **offentlige** publishable-nøgle står som konstanter i filen (de må ligge i
    appen; de kan ikke læse databasen).
  - Sky: edge-funktionen `sky` + tabellen `public.sky_backup`. Tabellen har
    **RLS til og ingen policies** + grants trukket fra `anon`/`authenticated`,
    så **kun funktionen (service_role) kan røre den**. Al krypto er standard
    WebCrypto i Deno — ingen afhængigheder. (Deploy sker via Supabase-værktøjet;
    kildekoden til funktionen står i denne overdragelse-runde.)
  - `storage/settings.ts`: `sky_code`, `sky_enabled`, `sky_last_ms` +
    `getSkyConfig/setSkyCode/setSkyEnabled/…`. Kodeordet er bevidst **UDE af
    `SETTING_KEYS`** i `storage/backup.ts` (det er krypteringsnøglen; må aldrig
    havne inde i selve kopien).
  - `storage/cloudBackup.ts` kører den ugentlige kopi ved opstart (kaldt fra
    `HomeScreen`); UI har "Gem nu" og "Hent fra skyen".
- **Sikkerhed:** panelets adresse **og kodeord** ligger aldrig i klartekst i
  databasen (alt krypteres med brugerens kodeord, AES-GCM, nøglen gemmes
  aldrig). Det er derfor forsvarligt at tage panel-kodeordet med i den
  **krypterede** sky-kopi (så en ny boks kan logge på selv) — modsat den gamle
  Google Drev-vej, der gemte kopien i **klartekst** på Drevet og derfor ikke
  måtte have kodeord med. Forkert kodeord → "ingen kopi" (både forkert
  hash-opslag og forkert dekryptering). Backuppen rummer grupper, favoritter,
  egne logoer, skjulte lande, indstillinger og panelet (adresse + brugernavn +
  kodeord). CLAUDE.md-reglen "ingen credentials i commits, logs eller chat"
  gælder stadig — kodeordet ligger kun i brugerens egen krypterede sky-kopi.
- **Vigtigt for brugeren:** kodeordet er det eneste, der kan låse kopien op.
  Glemmer han det, kan kopien ikke hentes (det er meningen). Skriv **præcis**
  det samme kodeord på den nye boks.

**Tv-rettelser i samme runde (alle i `ANDROID-TV.md`-ånd):**
- Grupper: navnet kan skrives (første række slap fokus til feltet).
- Søgning i Kanaler: tastaturet lukker ikke midt i ordet (listen greb fokus).
- "Hele dagen" (kanalens dags-epg): kan rulles (manglede `keepInMiddle`).
- Markér favorit i Kanaler: fokus bliver hvor man er (sprang før til toppen;
  første række bad om fokus fast — nu kun én puls ved indgang).
- "Kanaler uden logo" er nu også på tv (Indstillinger → Kanallogoer).
- Logo-søgningen er bredere: Wikidata falder tilbage til ethvert opslag med et
  P154-logo, og vælgeren viser op til fem bud (`sync/logoSearch.ts`).
- To tekstfelter kædes med "næste" på tastaturet (`TvTextInput` videresender
  nu sin ref; pil-ned mellem felter er upålidelig på tv).

### Det der er på plads

- **Tv-udgaven** følger Googles regler for tv (D-pad, fokus, Tilbage,
  menusøjle, afspilningstaster). Reglerne og hvordan appen følger dem står
  i `docs/ANDROID-TV.md` afsnit 4, sammen med alle fælderne. Læs den før
  du ændrer noget der tegnes eller får fokus.
- **Tema**: lyst og mørkt, følger solen som standard (også på tv), kan
  låses under Indstillinger. Farver læses gennem `useTheme()`/`useStyles`.
- **Favoritgrupper**: én favoritliste med grupper ovenpå (Sport, Film …),
  brugerens egne. Gælder Favoritter, Guide og zapning. Skema v20.
- **Guide på tv**: gitteret holder på fokus, pil venstre/højre i kanten
  bladrer en time, gruppeknapper over gitteret, højre søjle beskriver
  udsendelsen man står på, Tilbage går til nu og så menuen.
- **Afspiller på tv**: egne knapper (ingen indbyggede), pause og spoling
  ved start forfra og i film, OK/pile/medietaster som Google kræver,
  altid mørkt tema, Videogengivelse (SurfaceView/TextureView) under
  Indstillinger, diagnoselinje med videosporet.
- **Radio**: populære stationer øverst (registrets stemmer), Mine stationer
  og Lande i toppen, stort cover med album/år/genre og et par linjer om
  sangen (iTunes + Wikipedia). NorRadio (bilen) har samme rækkefølge.
- **Plakater**: TMDB-fejl (forkert nøgle, nede) gemmes ikke som "findes
  ikke"; "Hent kanaler, film og serier nu" glemmer gamle nej.
- **Indstillinger på tv** viser kun det der bruges der; tjenester foldet
  sammen; tema, sted for solen, videogengivelse.
- **Repositoriet er offentligt** (historikken er gennemgået for nøgler).
  Workflowet bruger secret `EXPO`; det gamle Expo-token skal være
  tilbagekaldt.

### Nyt siden 12. september — bygget, endnu ikke prøvet på enhed

Brugerens svar på idélisten var "lav det hele undtagen Emulator". Alt
nedenfor er kodet, typechecket og testet, men **ikke set på tv, telefon
eller i bilen** før de næste builds. Regn med småting.

- **Forsiden**: rækkerne "Fortsæt hvor du slap" (arkiv-udsendelser man
  ikke så færdig, med bjælke og "Fra N min"), "Sidst sete" (kanaler),
  "<gruppe> nu" per favoritgruppe og "Nye afsnit" (fulgte serier).
  `features/home/FrontScreen.tsx`; lagring i `storage/history.ts`,
  `storage/followedSeries.ts`. Skema v21.
- **Påmindelser**: "Mind mig om det" i programarket for kommende
  udsendelser (guide og kanaldag). `features/reminders/ReminderBanner.tsx`
  viser et banner øverst til højre 3 min før start, med "Se nu" i fokus på
  tv; Tilbage lukker. **Kun mens appen er åben** — ingen
  systemnotifikation. `storage/reminders.ts`.
- **Følg serien**: knap på seriens side; `sync/vodDetails.ts`
  `refreshFollowedSeries` henter fulgte serier igen hver 6. time som del af
  synk, og forsiden viser dem med nye afsnit.
- **Automatisk ugentlig sikkerhedskopi** (kun telefon): vælg mappen én
  gang under Indstillinger → Sikkerhedskopi; adressen gemmes
  (`backup_folder_uri`), og ved start skrives filen igen når der er gået en
  uge (`storage/autoBackup.ts`, kaldt 15 s efter start i HomeScreen). Fejler
  mappen, står det i rækken.
- **Gem sang** (NorRadio og NorStreams radio): knap under sangen når
  streamen fortæller hvad der spilles; listen "Gemte sange" åbner sangen i
  Spotify (`spotify:search:` og ellers open.spotify.com), hold nede
  fjerner. Skema v22 `saved_songs`, `storage/savedSongs.ts`,
  `features/radio/SavedSongsScreen.tsx`, `useSaveSong.ts`. I bilen: et
  bogmærke ved siden af hjertet (`CMD_SAVE_SONG` i `RadioAutoService.kt`,
  `SavedSongs.kt` lægger til side, `applyCarSongs` i `radio/src/library.ts`
  fører ind ved næste åbning).
- **Vækkeur i NorRadio**: `⏰ Vækkeur` i toppen; klokkeslæt, en af Mine
  stationer, kontakt. `Alarm.kt` (AlarmManager `setAlarmClock`),
  `AlarmReceiver.kt` starter tjenesten med `ACTION_RING`, som
  `RadioAutoService.onStartCommand` afspiller; sættes op igen dagligt og
  efter genstart. Tilladelser `USE_EXACT_ALARM`/`SCHEDULE_EXACT_ALARM`/
  `RECEIVE_BOOT_COMPLETED`. Uden lov til præcise alarmer viser siden en
  vej til systemindstillingen. Ikke prøvet: om media3 når at gå i
  forgrunden i tide på alle telefoner, og batterisparetilstand.
- **Biograf under Film** (`features/vod/CinemaScreen.tsx`): TMDB's lister
  "now_playing" og "upcoming" for Danmark (`cinemaTitles` i
  `sync/tmdbHome.ts`, huskes 6 timer via `sync/shelfCache.ts`, som
  forsidens hylder nu også bruger). OK på en plakat: ark med dansk titel,
  år, karakter, premieredato, "Se i din pakke" når `findInPanel` finder
  filmen i panelet, og "Se trailer" (trailer-ruten med `itemKey: null`,
  Tilbage går til Hjem). Kræver TMDB-nøgle. Plakatkortet er fælles:
  `ui/TitleCard.tsx`.
- **QR til den direkte overførsel** (`features/settings/QrCode.tsx` med
  qrcode-generator tegnet som Views, `QrScanner.tsx` med expo-camera):
  tv'et viser en QR med `NS:<ip>:<port>:<pin>`, telefonen scanner den og
  sender selv. Kamera-tilladelse via expo-camera-plugin i app.json. Tastning
  bevaret som reserve.
- **Direkte telefon → tv** (`features/settings/LocalTransfer.tsx`,
  native `packages/app/modules/local-backup`): tv'et starter en lille
  HTTP-server (Kotlin ServerSocket), viser sin ip:port og en firecifret
  kode; telefonen POST'er filen med koden i `X-Norstream-Pin`. Kun lokalt
  wi-fi, kun mens siden er åben; afsenderen bruger almindelig fetch (intet
  native). Ingen sky, ingen konto, intet USB. Manifest-tilladelser
  INTERNET/ACCESS_WIFI_STATE. (WebDAV-skyen blev bygget og rullet tilbage
  igen — brugeren ville ikke have den; se git-historik.)
- **Sikkerhedskopi på USB** (tv): native-modulet `packages/app/modules/usb-storage`
  finder USB-drev der sidder i (`getExternalFilesDirs` + `StorageVolume`),
  og appen skriver/læser `norstream-sikkerhedskopi.json` i sin egen mappe
  på drevet (`Android/data/dk.seomidt.norstream/files`) uden tilladelser.
  Rækkerne Gem på USB nu, Automatisk hver uge på USB (`backup_folder_uri`
  = `usb`) og Gendan fra USB under Indstillinger. Ny boks: log ind, sæt
  drevet i, Gendan fra USB. Fælde: afinstalleres appen mens drevet sidder
  i, sletter Android appens mappe på drevet — tag drevet ud først. Kræver
  en USB-hub med strøm igennem på Google TV Streamer; ikke prøvet endnu.
- **Gendan fra link** (`features/settings/backupLink.ts`): tv'et har
  ingen filvælger, så sikkerhedskopien hentes fra et delelink (Drev,
  Dropbox, OneDrive skrives om til direkte download). Feltet står under
  Sikkerhedskopi på både tv og telefon.
- **Grupper på tv**: navnefeltet findes kun efter "Omdøb"; lå det fast,
  tog det fokus ved hvert flueben (tastatur frem, listen til toppen).
- **DNS over HTTPS som nødudgang** (`net/doh.ts`): fejler et panelkald
  uden svar, slås navnet op hos Google/Cloudflare, og kaldet sendes igen
  til adressen med `Host`-hoved; adressen huskes en time og bruges også
  til streams (`streamSource` i afspiller, preview og film). Kun http.
  Hvis brugerens problem på dansk Wi-Fi er DNS-blokering, kan det gøre
  VPN'en overflødig — kør forbindelsestjekket for at se det.
- **Opdater appen af sig selv** (så en boks i en anden by kan opdateres
  uden Play Store): tv'et ser efter en nyere udgave ved hver opstart og
  starter installationen selv (`features/settings/autoUpdate.ts`, kaldt fra
  `App.tsx`; telefonen beholder den frivillige knap). Udgivelsen sker med
  workflowet `.github/workflows/udgiv-apk.yml`, som ligger på `main` og
  lægger en færdig byg-kørsels APK op med et fast mærkat
  (`latest-norstream`, `latest-norstream-tv`, `latest-norradio`). Appen
  sammenligner `versionCode` med udgivelsens note. **Hæv
  `expo.android.versionCode` i `app.json` før hvert build.** Hele fremgangs­-
  måden står i `docs/BYG-FRA-CHAT.md` afsnit 9. Byg-opskriften er med vilje
  ikke rørt: en ændret byg-fil bliver sat i "afventer godkendelse".

### Åbne punkter

- **DR-kanaler er grønne ved start forfra på tv'et** (lyd, ingen billede),
  mens TV 2 virker og samme udsendelse virker på telefonen. Diagnoselinjen
  siger `avc 1280×720 · understøttet`. Det virkede samme morgen. Hverken
  format (`.ts`/HLS), TextureView, genstart eller VPN-skift har ændret det.
  Det der er tilbage at prøve: samme udsendelse på telefonen gennem NordVPN
  New York (server for amerikanske adresser?), og et Android-log fra
  Streameren (`adb logcat` med ExoPlayer-linjer) hvis det kan skaffes.
- **Brugeren kører NorStream gennem NordVPN (split tunneling, kun
  NorStream, New York).** Panelet svarer ikke fra dansk Wi-Fi og ikke fra
  Boston. Forbindelsestjekket under Indstillinger → Kilder siger om det er
  DNS eller adresse; ikke kørt endnu.
- Android Auto: rul-til-top i NorRadio (ældre punkt). Apple TV og Google
  Play: se `docs/ANDROID-TV.md` afsnit 7.

### Hvordan det er verificeret

- 524 tests og typecheck grønne i app-pakken, 4 tests og typecheck i
  radio-pakken.
- Alt tv-arbejde er verificeret af brugeren på fjernsynet med fotos; der
  er ingen emulator i kæden. Skærmkomponenterne har ingen enhedstests.

## Panelets faktiske karakteristika

Målt, ikke gættet. Disse tal er grunden til at det oprindelige design ikke holdt:

| | Værdi |
|---|---|
| Kategorier | 285 |
| Kanaler | 22.142 |
| XMLTV-fil | 98 MB (bruges ikke længere) |
| Kanaler med `epg_channel_id` | 13% (3.009) |
| Kanaler med arkiv | 1.095 |
| **Samtidige forbindelser** | **1** |
| Panelets tidszone | `Europe/Amsterdam` |
| Kategorinavne | Landepræfiks: `DENMARK HD & HEVC` |
| Kanalnavne | Landepræfiks: `DNK\| DR1 HD` |

**`max_connections: 1` er en hård designbegrænsning.** Den udelukker at se på telefon og fjernsyn samtidig, og den former mini-previewet: hver ny stream lukker den forrige helt ned og venter på det, og previewet frigives før navigation til afspilleren.

## Næste skridt

1. **DR grøn skærm** (se åbne punkter). Første prøve er telefonen gennem
   NordVPN New York på samme udsendelse.
2. **Kør forbindelsestjekket** på dansk Wi-Fi uden VPN. Er dommen
   DNS-blokering, burde nødudgangen i `net/doh.ts` nu klare det uden VPN;
   prøv en kanal uden VPN bagefter.
3. **Prøv det nye** (afsnittet ovenfor) på tv, telefon og i bilen, og ret
   det der driller. Vækkeuret og bogmærket i bilen er de to ting med mest
   Android-maskineri i.
4. Idéer der er drøftet men ikke bygget: se "Parkerede punkter".

### Hvis noget ikke virker

Læs `docs/superpowers/plans/2026-09-05-udfoerelse.md` først. Den rummer hver afvigelse fra spec'en med begrundelse, og de fire fejl browserkørslen fandt. Flere af dem forklarer hvorfor koden ser ud som den gør.

## Dokumenter

| Dokument | Hvad |
|---|---|
| `docs/BUILD.md` | Hvordan appen bygges, verificeres og installeres. Læs den før du bygger |
| `docs/BYG-FRA-CHAT.md` | Sådan Claude bygger fra en ny chat: workflow-input, følg bygget, måleskripter, hvad brugeren skal have at vide, sikkerhed |
| `docs/ANDROID-TV.md` | Alt om tv-udgaven: byg, installation på Google TV, lærredet, fjernbetjeningen, tjekliste og fælder. Læs den før du ændrer noget der tegnes |
| `docs/superpowers/specs/2026-09-05-navigation-og-epg-design.md` | Godkendt design for alt ovenstående |
| `docs/superpowers/plans/2026-09-05-epg-og-guide.md` | Plan 1, med tre afvigelser fra spec'en og hvorfor |
| `docs/superpowers/plans/2026-09-05-navigation.md` | Plan 2, med tre afvigelser fra spec'en og hvorfor |
| `docs/superpowers/plans/2026-09-05-udfoerelse.md` | Udførelseslog: hver beslutning, og hvad verifikationen fandt |
| `docs/superpowers/specs/2026-09-04-uhf-play-design.md` | Oprindeligt design, gælder stadig for alt de nyere ikke ændrer |
| `docs/superpowers/plans/2026-09-04-*` | Historik fra core- og app-lagene, inkl. 30 rulings |

De historiske dokumenter bruger stadig navnet "UHF Play" og kommandoer som `npm test --workspace @uhf-play/core`. Det er med vilje: de beskriver arbejde udført dengang. Skal du køre en kommando derfra, så oversæt scopet til `@norstream/`.

## Hvad du bør vide om koden

**Læs de tre afvigelsesafsnit i planerne før du ændrer noget i EPG, skema eller favoritter.** Hver af dem er et sted hvor spec'en ikke holdt ved kontakt med virkeligheden, og hvor en "oprydning" tilbage til spec'ens ordlyd ville genindføre en fejl.

Kort:

- **Cache-regel 1 betyder "der er ikke hentet", ikke "der er ingen programmer."** Den anden læsning giver et panel-kald ved hver rendering for hver kanal uden EPG.
- **Migreringen bevarer `timeshift_dialect`.** Den findes kun ved en probing der kun kører under onboarding; slettes den, mister eksisterende installationer start-forfra permanent.
- **`favorite_exclusions` findes fordi "opdatér" ellers henter fjernede kanaler tilbage.** Uden den fortryder knappen brugerens oprydning hver gang han bruger den.
- **`Alert.alert` må ikke bruges.** react-native-web implementerer den ikke, så flowet dør stille der. Brug `src/ui/Notice.tsx`.
- **`db.ts` bruger en eksplicit adapter, ikke en cast.** `expo-sqlite`s overloads matcher aldrig `SqlDatabase` direkte. Genindfør ikke `as unknown as`.
- **`packages/core` må ikke importere React Native, `react` eller Node-moduler.** CI fejler hvis den gør. `tsconfig` har `lib: ["ES2022"]` uden `DOM` med vilje — det er derfor base64 er skrevet fra bunden i stedet for at bruge `atob`.
- **Testene må ikke bruge vægururet.** Alt der har brug for "nu" tager et eksplicit `now`.

## Praktisk

### Build

**Fuld vejledning: `docs/BUILD.md`** — hvert felt forklaret, hvad der sker på
Expos side, og alle de fælder der har kostet tid, også ved at installere
APK'en. Læs den før du bygger; her står kun det der ikke står der.

```bash
cd packages/app
npx eas-cli@latest build --platform android --profile preview --non-interactive --no-wait
```

Android er gratis hele vejen. **iOS og Apple TV kræver Apple Developer Program, 99 USD/år**, selv til privat brug via TestFlight. TestFlight-builds udløber efter 90 dage.

**Builds kræver adgang til `api.expo.dev`.** Det har en maskine hvor `eas login`
er kørt, og en GitHub-runner med `EXPO_TOKEN`. Det har derimod ikke
nødvendigvis en agent-session: nogle miljøer blokerer værten i deres
netværkspolitik, og så fejler ethvert EAS-kald med `Forbidden` eller
`CONNECT tunnel failed, response 403`. Det er gatewayen, ikke tokenet —
`curl -sS "$HTTPS_PROXY/__agentproxy/status"` viser afvisningen direkte. Kør
`npx eas-cli@latest whoami` før du konkluderer noget, som BUILD.md siger.

`.github/workflows/build-android.yml` findes til netop det: den bygger fra en
GitHub-runner, som har adgangen uanset hvor den der beder om buildet sidder.
Den kræver `EXPO_TOKEN` som repository secret og udløses manuelt under Actions.
Før selve builden kører den typecheck, tests og manifest-kontrollen nedenfor.

### Verificér en rettelse **før** du bygger

BUILD.md beskriver at pakke den færdige APK ud. Det er den rigtige
slutkontrol — men det samme kan gøres **før** builden, på et sekund i stedet
for ti minutter:

```bash
cd packages/app
npx expo prebuild --platform android --no-install
grep -n 'usesCleartextTraffic' android/app/src/main/AndroidManifest.xml
```

`prebuild` genererer præcis det native projekt EAS selv bygger. Manifestet er
læsbar XML, så `usesCleartextTraffic`, pakkenavn og rettigheder kan efterses
direkte. Mappen `android/` er git-ignoreret (`packages/app/.gitignore`) og
påvirker hverken repoet eller cloud-builden, som prebuilder selv.

Metoden fandt selv en **tredje** fejl af samme slags som `usesCleartextTraffic`:
`userInterfaceStyle: "dark"` stod i `app.json`, men blev **ignoreret**, fordi
`expo-system-ui` ikke var installeret. Prebuild sagde det højt; et build ville
bare have været grønt. Mønsteret er nu set tre gange, og det er værd at sige
rent ud: **en nøgle i `app.json` kan blive læst og alligevel aldrig anvendt.**
Kun manifestet afgør det.

### Kør appen lokalt uden panel

Browserkørslen der fandt fire fejl kan gentages. Et lille falskt Xtream-panel plus `npx expo export --platform web` (kørt **fra `packages/app`**, ikke fra roden) og en headless browser er nok. Fremgangsmåden står i udførelsesloggen.

### Fælder der har kostet tid

- **Android blokerer `http` som standard.** Panelet kører uden TLS. Løst med `expo-build-properties`.
- **Panelet har ingen HTTPS.** Adressen skal være `http://`.
- **`node:sqlite` kræver Node 24.** CI pinner Node 24.
- **`Alert.alert` gør intet på web.** Se ovenfor.
- **`npx expo export` skal køres fra `packages/app`.** Fra roden fejler den på entry-punktet.
- **En indstilling i `app.json` kan blive læst og alligevel ikke anvendt.** Det
  gælder `usesCleartextTraffic` (kræver `expo-build-properties`) og
  `userInterfaceStyle` (kræver `expo-system-ui`). Begge fejlede stille. Kør
  `expo prebuild` og læs manifestet frem for at stole på at noget kom med.
- **Er `api.expo.dev` blokeret, er `dl.google.com` det typisk også.** Så kan
  Android SDK'et heller ikke hentes, og APK'en kan ikke bygges lokalt som
  alternativ. Brug GitHub-workflowen i stedet — se "Build" ovenfor.

### Credentials

Brugerens panel-adgangsoplysninger står **ikke** i dette repo og skal ikke skrives ind. Appen gemmer dem i `expo-secure-store` på enheden; på web kun i hukommelsen, aldrig i `localStorage`.

**Bemærk:** Xtream lægger brugernavn og adgangskode i URL-stien, og panelet kører `http`. Credentials sendes altså ukrypteret. Det er panelets vilkår, ikke appens — men det er grunden til at fejlbeskeder aldrig må vise en rå stream-URL.

## Parkerede punkter

1. **EAS-projektets slug hedder stadig `iptv-norlys`** og skal omdøbes manuelt på expo.dev. Omdøbes projektet der til `norstream`, skal `slug` i `app.json` ændres tilsvarende, ellers afvises builds med *"slug does not match"*. Gør begge dele eller ingen af dem.
2. **Den lokale mappe hedder stadig `uhf-play`** — rent kosmetisk. Det samme gælder databasefilens navn `uhf-play.db`, som med vilje er uændret: skiftes det, mister eksisterende installationer deres favoritter, fordi migreringen så ikke finder den gamle database.
3. **Guiden henter 12 programmer per kanal.** Sider man langt frem, løber den tør for data og viser huller. Flere kræver et højere `limit` eller flere kald.
4. **Ingen UI-tests.** `vitest.config.ts` matcher kun `.ts`, ikke `.tsx`. Browserkørslen dækker hullet manuelt, men den er ikke automatiseret.
5. **Kanaler hvis `category_id` ikke peger på en kendt kategori** tælles ikke med i landeoversigten og kan kun findes via søgning.
6. **Indbygget VPN** (WireGuard via `VpnService`, kun NorStreams trafik) er drøftet og fravalgt så længe udbyderen er NordVPN, som ikke udleverer WireGuard-opsætninger officielt. Nords egen tv-app med split tunneling gør det samme.
7. **Faner skifter ved fokus i menusøjlen**, ikke ved OK. Googles faneside siger "ved valg", men Googles egne tv-apps gør som vi. Bevidst valg.
8. **Påmindelser er kun i appen.** En rigtig notifikation kræver
   `expo-notifications` og planlagte lokale notifikationer; det er ikke
   sat op, fordi tv'et alligevel viser appen når man ser fjernsyn.
9. **Emulator i byggekæden** er fravalgt af brugeren indtil videre.

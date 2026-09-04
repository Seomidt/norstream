# UHF Play — Arkitektur og design

**Dato:** 2026-09-04
**Status:** Godkendt design, klar til implementeringsplan
**Omfang af dette dokument:** Delprojekt 1 (core) og 2 (mobil-app). Delprojekt 3-5 er beskrevet på oversigtsniveau og får hver sin egen spec.

---

## 1. Formål og baggrund

Byg en IPTV-klient med samme brugsoplevelse som Norlys Play, men som henter indhold fra et
Xtream Codes-panel (og rene M3U-playlister) i stedet for en lukket udbyder-backend.

Referencen er Norlys Play: kanalliste, TV-guide, live-afspilning på tværs af telefon, tablet og
TV, plus start-forfra. Brugeren har allerede en server der udstiller kanaler via både M3U og
Xtream Codes API, så indholdssiden er løst — projektet handler udelukkende om klienten.

## 2. Mål og ikke-mål

### Produktmål

- Kanalbrowsing med kategorier, søgning og favoritter
- TV-guide (EPG) med programoversigt, der er brugbar på TV-hardware
- Stabil live-afspilning med automatisk genforbindelse ved udfald
- Start forfra på udsendelser, hvor panelet har arkiv
- Fire platforme: iOS, Android, Apple TV, Android TV
- Fungerer på cached data når panelet er utilgængeligt

V1 leverer disse mål på mobil (delprojekt 1 og 2). V2 udvider dem til Apple TV og
Android TV (delprojekt 3).

### Ikke-mål

- **Smart TV (Samsung Tizen, LG webOS).** Separate SDK'er og indsendelsesprocesser; eget spor hvis det bliver relevant.
- **Konto-system og betaling.** Hver bruger indtaster egne credentials lokalt.
- **DRM-beskyttet indhold.** Xtream-kilder er ubeskyttede streams; ingen Widevine eller FairPlay.
- **Ægte cloud-optagelse i v1.** Kræver recorder-komponenten (delprojekt 4).
- **Preloading af nabokanaler.** Senere optimering; koster for meget hukommelse på TV-bokse.

## 3. Brugere og distribution

5-30 brugere: udvikleren selv plus venner og familie. Hver bruger indtaster sine egne
Xtream-credentials ved onboarding. Ingen central backend, intet konto-system, ingen
brugeradministration.

Distribution sker uden om de offentlige app stores:

| Platform | Metode |
|---|---|
| iOS / Apple TV | TestFlight (op til 100 interne testere) |
| Android / Android TV | Direkte APK-distribution eller intern testkanal |

## 4. Dekomponering og byggerækkefølge

Projektet er for stort til én spec og én implementering. Det brydes i fem delprojekter, der
bygges i denne rækkefølge:

| # | Delprojekt | Begrundelse for placering i rækkefølgen |
|---|---|---|
| 1 | **Core-lag** — Xtream-klient, M3U- og XMLTV-parsing, datamodel | Alt andet afhænger af det. Platform-uafhængigt og hurtigt at teste. |
| 2 | **Mobil-app** — kanalliste, guide, afspiller, favoritter | Hurtigst feedback, nemmest at teste, validerer core-laget i praksis. |
| 3 | **TV-app** — Apple TV og Android TV | Fjernbetjenings-UX er et andet paradigme; bygges når datalaget er bevist. |
| 4 | **Recorder-server** — ffmpeg til GCS eller OneDrive | Låser ægte optagelse op ud over panelets eget arkiv. |
| 5 | **Sync-backend** — favoritter og fortsæt-afspilning på tværs | Først værdifuldt når der findes mindst to klienter. |

Delprojekt 1 og 2 udgør v1 og er omfattet af dette dokument. Hvert efterfølgende delprojekt får
sin egen spec og implementeringsplan.

## 5. Teknologivalg

**Valgt: React Native med `react-native-tvos`-forken.**

Det er den eneste stack der dækker alle fire målplatforme i én kodebase. Videoafspilning sker
native under motorhjelmen — ExoPlayer på Android, AVPlayer på iOS og tvOS — via
`react-native-video`, så afspilningskvaliteten er reelt på niveau med en native app.
Fjernbetjeningsnavigation håndteres af `TVFocusGuideView`.

### Fravalgte alternativer

**Native per platform med delt Kotlin Multiplatform-kerne.** Giver den bedste TV-oplevelse og er
sådan kommercielle streaming-apps bygges. Fravalgt fordi det kræver to UI-kodebaser og realistisk
2-3 gange udviklingstiden for en enkelt udvikler. Afvejningen er de sidste ti procent
UI-smoothness mod halvdelen af arbejdet.

**Flutter.** Understøtter ikke tvOS officielt. Apple TV ville kræve en separat native app
alligevel, hvilket underminerer hele pointen med én kodebase.

### Kendte omkostninger ved valget

- `react-native-tvos` er et fork der halter efter mainline React Native. RN-versionen pinnes til
  det forken understøtter, og opgraderinger planlægges bevidst frem for automatisk.
- EPG-gitteret er den tungeste UI i appen og kræver omhyggelig virtualisering for at køre glat på
  TV-hardware.

### Nøgleafhængigheder

| Pakke | Formål |
|---|---|
| `react-native-tvos` | RN-fork med tvOS- og Android TV-understøttelse |
| `react-native-video` | Afspilning via ExoPlayer og AVPlayer |
| `react-native-keychain` | Krypteret opbevaring af credentials |
| `op-sqlite` | Lokal database til kanaler og EPG |
| `@shopify/flash-list` | Virtualiserede lister og EPG-gitter |
| `vitest` | Unit-test af core-pakken i Node |

## 6. Arkitektur

Monorepo med to pakker:

```
uhf-play/
  packages/
    core/          ren TypeScript, ingen React Native-afhængigheder
      xtream/      XtreamClient: auth, kategorier, kanaler, EPG, catch-up
      m3u/         M3UParser — fallback for rene playlist-kilder
      epg/         XmltvParser
      models/      Channel, Category, Programme, CatchupWindow
      urls/        URL-byggere til live, timeshift og catch-up
    app/           React Native — iOS, Android, tvOS, Android TV
      data/        repositories der binder core sammen med persistering
      features/    onboarding, channels, guide, player, settings
      player/      wrapper om react-native-video med platform-særheder
      navigation/  separate navigatorer for touch og fjernbetjening
      ui/          delte primitiver og tema
```

### Hvorfor core er isoleret fra React Native

`core` importerer intet fra React Native og kan derfor køre i Node. Det giver hurtige unit-tests
uden emulator på netop den logik hvor fejl er sværest at opdage manuelt: tidszoner i EPG-data,
kanaler der falder ud af mapping, catch-up-vinduer beregnet forkert. Det er hovedparten af den
ikke-visuelle kompleksitet i projektet.

Grænsefladen mellem lagene: `core` kender kun HTTP og rene datastrukturer. Den ved intet om
persistering — `app/data` ejer SQLite og kalder ind i `core` for at hente og parse.

### Deling mellem touch og TV

Metro understøtter `.tv.tsx`-filendelser. Skærme hvor fjernbetjening kræver reelt anderledes UX —
guiden og afspilleren — får en `.tv.tsx`-variant. Alt under view-laget deles fuldstændigt:
repositories, state, forretningslogik, URL-bygning. UI duplikeres kun hvor
interaktionsmodellen faktisk adskiller sig.

## 7. Datalag og EPG

### Flow

1. Onboarding: brugeren indtaster Xtream-credentials eller en M3U-URL. Credentials gemmes i
   `react-native-keychain` (iOS Keychain, Android Keystore), aldrig i AsyncStorage.
2. `XtreamClient` henter kategorier og kanaler fra `player_api.php` og skriver dem til SQLite.
3. EPG hentes fra `xmltv.php`, parses streamet, og skrives til SQLite indekseret på
   `(channel_id, start_time)`.
4. UI læser altid fra SQLite, aldrig direkte fra netværket.
5. Baggrundsopdatering: kanaler dagligt, EPG hver sjette time.

### Hvorfor SQLite er et krav, ikke en optimering

En XMLTV-fil for et fuldt kanaludbud er typisk 10-50 MB gzippet XML med hundredtusindvis af
programmer. Den naive tilgang — hent alt, hold det i hukommelsen — vil crashe appen på en Android
TV-boks med 2 GB RAM. Derfor streamet parsing og vinduesforespørgsler, så guiden kun læser de
programmer der er synlige i det aktuelle tidsvindue.

Konsekvensen er samtidig en funktion: appen virker på cached data uden netværk, og opstart er
øjeblikkelig efter første synkronisering.

## 8. Afspiller, zapping og start-forfra

### Stream-format per platform

Xtream-paneler udstiller hver kanal i to varianter:

| Format | URL-mønster | Understøttet af |
|---|---|---|
| MPEG-TS | `/live/USER/PASS/{id}.ts` | ExoPlayer (Android, Android TV) |
| HLS | `/live/USER/PASS/{id}.m3u8` | Alle platforme |

**AVPlayer på iOS og tvOS kan ikke afspille rå MPEG-TS over HTTP.** Appen vælger derfor format ud
fra platform: altid `.m3u8` på Apple, `.ts` foretrukket på Android for lavere latenstid, med
`.m3u8` som fallback. Dette er den enkeltdetalje der oftest bryder hjemmebyggede IPTV-klienter.

### Zapping

Én afspiller-instans der skifter kilde. Oplevet hastighed kommer fra øjeblikkelig UI-respons:
kanalnavn og -nummer vises straks, og sidste frame fastholdes i stedet for at blinke sort, mens
video indhenter.

### Start forfra

Panelet markerer arkiv per kanal i `get_live_streams` via `tv_archive` og `tv_archive_duration`
(antal dage). Ser brugeren en udsendelse kl. 20:37 der begyndte 20:00, bygger appen en
timeshift-URL med starttidspunkt og programvarighed, skifter kilde, og afspilningen fortsætter
fra begyndelsen med fuld søgebar.

Der findes to URL-dialekter blandt paneler i drift:

- `/streaming/timeshift.php?username=U&password=P&stream={id}&start={YYYY-MM-DD:HH-MM}&duration={min}`
- `/timeshift/USER/PASS/{duration}/{start}/{id}.m3u8`

Appen prober under onboarding hvilken dialekt panelet svarer på, og gemmer resultatet. Dermed
virker start-forfra uafhængigt af panel-version.

### Optagelse i v1

Knappen "optag" gemmer et catch-up-bogmærke på de kanaler hvor panelet har arkiv. Ægte
cloud-optagelse til Google Cloud Storage eller OneDrive kræver recorder-komponenten og ligger i
delprojekt 4.

## 9. Fejlhåndtering

IPTV-streams falder ud regelmæssigt. Robusthed er kernefunktionalitet i denne app, ikke pynt.

| Situation | Håndtering |
|---|---|
| Stream loader ikke | To forsøg med backoff, derefter automatisk fallback til det andet containerformat, derefter fejlbesked med prøv-igen |
| Stream hakker eller stopper midt i afspilning | Detekteres på afspillerens buffer-events, automatisk genforbindelse |
| Panelet er utilgængeligt | Appen kører videre på cached SQLite-data med et diskret offline-banner |
| Credentials afvist (401 eller udløbet) | Keychain ryddes, brugeren sendes til onboarding med en forklarende besked |
| EPG-parsing fejler | Guiden viser "ingen programdata"; kanalliste og afspilning virker uændret |

Den sidste regel er et hårdt princip: **EPG-fejl må aldrig blokere afspilning.** Guiden er en
bekvemmelighed, afspilning er produktet.

## 10. Teststrategi

**`core` — Vitest, test-først.** Rene funktioner over fixtures, hentet fra det rigtige panel og
renset for credentials. Dækker M3U-parsing inklusive kanttilfælde, XMLTV-tidszonehåndtering,
catch-up-URL-generering i begge dialekter, og kanal-til-kategori-mapping. Dette lag udvikles med
TDD, da det er rent input og output og ideelt til det.

**`app` — React Native Testing Library.** Repositories, state-overgange og guidens
vinduesberegning. Ikke pixel-tests af UI.

**Afspilning — manuel tjekliste.** Videoafspilning på tværs af fire platforme kan ikke
automatiseres meningsfuldt. Hver release verificeres manuelt på iPhone, Android-telefon, Apple TV
og en Android TV-boks: kanalskift, start-forfra, og genforbindelse efter netværksafbrydelse.

## 11. Fremtidige delprojekter

**Delprojekt 3 — TV-app.** Genbruger core og datalag uændret. Nyt: fjernbetjeningsnavigation,
fokus-håndtering, EPG-gitter tilpasset D-pad, og et kanal-overlay til zapping.

**Delprojekt 4 — Recorder-server.** Always-on komponent der optager streams med ffmpeg og skubber
til Google Cloud Storage eller OneDrive. Låser optagelse op på kanaler uden panel-arkiv og giver
start-forfra uafhængigt af udbyder. Kræver egen spec, herunder lagerbudget og opbevaringspolitik.

**Delprojekt 5 — Sync-backend.** Favoritter og fortsæt-afspilning delt mellem enheder.

## 12. Kendte risici

| Risiko | Håndtering |
|---|---|
| `react-native-tvos` halter efter mainline RN | RN-version pinnes; opgraderinger planlægges bevidst |
| EPG-gitteret performer dårligt på svag TV-hardware | Virtualisering fra dag ét; performance testes på en rigtig Android TV-boks, ikke i emulator |
| Panel-dialekter varierer mellem versioner | Probing ved onboarding frem for hårdkodede antagelser |
| Apple TestFlight-grænse på 100 testere | Rigeligt til 5-30 brugere; ikke en begrænsning i praksis |

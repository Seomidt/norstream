# NorStream — overdragelse

**Dato:** 2026-09-05
**Til:** næste session, eller enhver der samler projektet op

Dette dokument er udgangspunktet. Alt andet i `docs/` er detaljer; dette er hvad du skal vide først.

---

## Hvad projektet er

En IPTV-app med Norlys Play-agtig brugsoplevelse, der henter indhold fra brugerens eget Xtream Codes-panel. Bygget i en npm-monorepo:

- **`packages/core`** — platform-uafhængigt TypeScript-bibliotek. M3U- og XMLTV-parsing, Xtream-klient, URL-byggere. **93 tests.** Ingen runtime-afhængigheder, ingen React Native-imports. CI håndhæver begge dele.
- **`packages/app`** — Expo SDK 57-app (React Native 0.86). **72 tests.**

**Repo:** https://github.com/Seomidt/norstream (privat). Alt er merget til `main`, CI er grøn.

Appen hed oprindeligt "UHF Play" og blev omdøbt til **NorStream** 2026-09-05. Repo, pakkenavne og EAS-projektet bærer stadig de gamle navne — se "Løse ender".

## Status: hvad virker

**Appen kører på Android og er verificeret mod brugerens rigtige panel.** Den forbinder, henter 22.142 kanaler, viser dem, og **afspiller**.

Verificeret undervejs, ikke antaget:
- Onboarding, fejlhåndtering og kanalliste kørt i browser med screenshots
- APK'ens manifest pakket ud og inspiceret efter hver rettelse
- Panelets API kaldt direkte med curl og sammenholdt med appens forventninger

## Status: hvad virker ikke

Tre ting, alle diagnosticeret med årsag:

| Problem | Årsag | Løsning |
|---|---|---|
| **EPG er tom** | Appen henter hele XMLTV-filen. Den er **98 MB** på dette panel, og appens timeout er 60 sekunder. Hentningen afbrydes altid. | `get_short_epg` per kanal — se spec |
| **Start-forfra virker ikke** | Følger af ovenstående: knappen skal kende programmets starttidspunkt. DR1 og TV 2 *har* 3 dages arkiv. | Følger med EPG-rettelsen |
| **Umuligt at navigere** | **285 kategorier** i en vandret række designet til en håndfuld. 22.142 kanaler i én flad liste. | Landegruppering — se spec |

## Panelets faktiske karakteristika

Målt, ikke gættet. Disse tal er grunden til at det oprindelige design ikke holdt:

| | Værdi |
|---|---|
| Kategorier | 285 |
| Kanaler | 22.142 |
| XMLTV-fil | 98 MB |
| Kanaler med `epg_channel_id` | 13% (3.009) |
| Kanaler med arkiv | 1.095 |
| **Samtidige forbindelser** | **1** |
| Panelets tidszone | `Europe/Amsterdam` (oplyses i `server_info.timezone`) |
| Kategorinavne | Landepræfiks: `DENMARK HD & HEVC`, `SWEDEN SPORT` |
| Kanalnavne | Landepræfiks: `DNK\| DR1 HD` |

**`max_connections: 1` er en hård designbegrænsning.** Den udelukker at se på telefon og fjernsyn samtidig, og den gør mini-preview skrøbelig: hver ny stream skal lukke den forrige helt ned først.

### Den bærende opdagelse

`get_short_epg` henter programoversigt for **én kanal** via `stream_id`:

```
GET /player_api.php?username=U&password=P&action=get_short_epg&stream_id=247634&limit=12
```

Svaret er få kilobyte. Titler og beskrivelser er **base64-kodet**; tider er **epoch-sekunder**.

Det afgørende: opslaget sker på `stream_id`, som alle kanaler har — ikke på `epg_channel_id`, som kun 13% har. Det fjerner hele den kobling der ellers gjorde EPG umulig for de fleste kanaler.

## Næste skridt

**Spec'en er skrevet og godkendt:** `docs/superpowers/specs/2026-09-05-navigation-og-epg-design.md`

Den dækker EPG-omlægningen, guiden, landegruppering med flag, kategori-favoritter og mini-preview. Den er inddelt i to delprojekter:

1. **Plan 1 — EPG og guide.** `getShortEpg` i core, cache med tre fornyelsesregler, skema v2 med migrering der bevarer favoritter, panelets tidszone, guide-skærm hvor start-forfra får et synligt hjem. **Planen er ikke skrevet endnu** — det er det første der skal gøres.
2. **Plan 2 — Navigation.** Landegruppering, skjulte lande, kategori-favoritter, mini-preview.

Brugeren vil have begge eksekveret **før** næste APK, så han kun skal teste én gang.

Følg processen: `superpowers:writing-plans` → `superpowers:subagent-driven-development`. Den har fanget elleve fejl i planerne indtil nu.

## Hvad du bør vide om processen

**Alle blokerende fejl har været i plandokumenterne, ikke i implementeringen.** Elleve i alt. Mønsteret er konsistent: planerne ræsonnerede fra deres egen referencekode i stedet for fra spec'en og bibliotekernes faktiske API'er. Tre fejlede *stille* — `pdc-start` læst som `start`, komma i `group-title`, manglende entity-afkodning. To var kommentarer der løj om hvad koden gjorde. Én var en test der bestod uanset om koden var rigtig.

**Læs udførelseslogge før du gætter.** `docs/superpowers/plans/*-udfoerelse.md` rummer samtlige 30 rulings med begrundelse og konsekvens. Flere af dem forklarer hvorfor koden ser ud som den gør.

To eksempler der sparer tid:

- **`db.ts` bruger en eksplicit adapter, ikke en cast.** `expo-sqlite`s overloads matcher aldrig `SqlDatabase` direkte. Den oprindelige `as unknown as` skjulte det. Genindfør den ikke.
- **`packages/core` må ikke importere React Native, `react` eller Node-moduler.** CI fejler hvis den gør. `tsconfig` har `lib: ["ES2022"]` uden `DOM` med vilje.

## Parkerede punkter

Fra det store review, ingen er bærende:

1. **`last_sync_ms` overlever udlogning** — logger man ind på et *andet* panel, vises det gamles kanaler i op til 24 timer. Én linje at rette. Vigtigst af de fire.
2. Tre uhåndterede rejections i `syncFromPanel` — en fejlende keychain-sletning afbryder udlogning stille.
3. EPG deler tæller med kanal-synk, så hyppig pull-to-refresh forhindrer EPG i at blive hentet. **Bortfalder med Plan 1.**
4. Omvendt kommentar i `syncEpg.test.ts` — **bortfalder med Plan 1**, filen slettes.

Derudover: **ingen UI-tests.** Skærmene har nul dækning, og `vitest.config.ts` matcher kun `.ts`, ikke `.tsx`. Det er et reelt hul, og fire af de fejl det store review fandt var netop state-fejl i skærmene.

## Praktisk

### Build

```bash
cd packages/app
npx eas-cli@latest build --platform android --profile preview --non-interactive --no-wait
```

Profilen `preview` giver en APK der kan deles direkte. **Verificér altid den byggede APK** frem for at antage en rettelse kom med — pak `AndroidManifest.xml` ud af zip-filen og se efter. Det afslørede at `android.usesCleartextTraffic` i `app.json` bliver læst men aldrig anvendt; det kræver `expo-build-properties`.

Android er gratis hele vejen. **iOS og Apple TV kræver Apple Developer Program, 99 USD/år**, selv til privat brug via TestFlight. TestFlight-builds udløber efter 90 dage.

### Fælder der har kostet tid

- **Android blokerer `http` som standard.** Panelet kører uden TLS (port 443 er lukket). Løst med `expo-build-properties`.
- **Panelet har ingen HTTPS.** Adressen skal være `http://`.
- **`node:sqlite` kræver Node 24.** CI pinnede Node 20 og fejlede efter merge.
- **Testene må ikke bruge vægururet.** Fem `syncEpg`-tests bestod den ene dag og fejlede den næste, fordi de ikke sendte et eksplicit `now`.

### Credentials

Brugerens panel-adgangsoplysninger står **ikke** i dette repo og skal ikke skrives ind. Appen gemmer dem i `expo-secure-store` på enheden; på web kun i hukommelsen, aldrig i `localStorage`.

**Bemærk:** Xtream lægger brugernavn og adgangskode i URL-stien, og panelet kører `http`. Credentials sendes altså ukrypteret. Det er panelets vilkår, ikke appens — men det er grunden til at fejlbeskeder aldrig må vise en rå stream-URL.

## Løse ender i navngivningen

Omdøbningen blev gennemført 2026-09-05.

| Hvad | Status |
|---|---|
| Appen (synligt navn) | **NorStream** ✅ |
| Android-pakke og iOS-bundle | **`dk.seomidt.norstream`** ✅ |
| npm-workspaces | **`@norstream/core`**, **`@norstream/app`** ✅ |
| GitHub-repo | **`Seomidt/norstream`** ✅ |
| EAS-projektets slug | `iptv-norlys` — **skal omdøbes manuelt på expo.dev** |
| Lokal mappe | hedder stadig `uhf-play` — rent kosmetisk |

**Pakkenavnet er ændret.** Alle der har den gamle APK skal **afinstallere den først** — Android ser den nye som en helt anden app og kan ikke opgradere oven i.

**EAS-slug'en hænger sammen med projektnavnet på expo.dev.** Omdøbes projektet der til `norstream`, skal `slug` i `app.json` ændres tilsvarende, ellers afvises builds med *"slug does not match"*. Gør begge dele eller ingen af dem.

De historiske planer og specs i `docs/superpowers/` bruger stadig det gamle navn, inklusive kommandoer som `npm test --workspace @uhf-play/core`. Det er med vilje: de beskriver arbejde udført dengang, og at omskrive dem ville forfalske historikken. Skal du køre en kommando derfra, så oversæt scopet til `@norstream/`.

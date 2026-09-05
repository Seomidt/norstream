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

Plan 1 (EPG og guide) og Plan 2 (navigation) er **implementeret og verificeret**, men **endnu ikke afprøvet på brugerens rigtige panel**. Det er det næste der skal ske: byg en APK og lad brugeren teste.

### Hvad der er lavet siden sidst

De tre problemer fra sidste overdragelse er alle adresseret:

| Var | Nu |
|---|---|
| EPG tom — 98 MB XMLTV nåede aldrig frem | `get_short_epg` per kanal, få kilobyte, slår op på `stream_id` som **alle** kanaler har |
| Start-forfra virkede ikke | Bor i guiden: tryk på et afsluttet program på en kanal med arkiv |
| 285 kategorier i én vandret række | Søgning → lande med flag → kategorier → kanaler |

Derudover: kategori-favoritter med gruppering, skjulte lande, mini-preview, indstillinger, panelets tidszone, og parkeret punkt 1 (`last_sync_ms` overlevede udlogning) er lukket.

**XMLTV-vejen er slettet.** `syncEpg.ts` findes ikke længere.

### Hvordan det er verificeret

- 298 tests og typecheck grønne i begge pakker
- Android-bundlen bygger og Hermes-kompilerer (661 moduler)
- **Hele den nye brugerflade kørt igennem i en rigtig browser mod et falsk Xtream-panel:** onboarding, landegruppering med flag, kategorier, "tilføj alle", favoritter, guidegitteret, sideskift i guiden, søgning på tværs, skjul/vis land, forhåndsvisning til og fra, og udlogning

Det sidste er nyt for projektet og fangede fire fejl som hverken typecheck eller tests så. Se `docs/superpowers/plans/2026-09-05-udfoerelse.md`.

### Hvad der **ikke** er verificeret

- **Intet er kørt mod brugerens rigtige panel.** Alt panel-samspil er afprøvet mod en lokal efterligning.
- **Ingen video er afspillet.** Det falske panel serverer ingen streams. Afspilning, start-forfra og mini-previewets lykkelige vej er uafprøvede i praksis.
- **Migreringen fra v1 er kun kørt mod `node:sqlite`,** ikke mod `expo-sqlite` på en rigtig enhed med rigtige data.
- Skærmkomponenterne har stadig ingen enhedstests. Den logik der kunne trækkes ud af dem — guidens layout, landeudledningen, cache-reglerne — er testet hver for sig.

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

1. **Byg en APK og lad brugeren teste.** Se "Build" nedenfor. Han skal **afinstallere den gamle app først** — pakkenavnet skiftede ved omdøbningen.
2. Bed ham især kigge efter: om EPG'en fylder ud i kanallisten og guiden, om start-forfra virker fra guiden på DR1 og TV 2, og om mini-previewet er til at leve med eller skal slås fra.
3. Første start efter opgraderingen **sletter og genopbygger den lokale database**. Favoritter og timeshift-dialekten bevares; kanaler og EPG hentes på ny.

### Hvis noget ikke virker

Læs `docs/superpowers/plans/2026-09-05-udfoerelse.md` først. Den rummer hver afvigelse fra spec'en med begrundelse, og de fire fejl browserkørslen fandt. Flere af dem forklarer hvorfor koden ser ud som den gør.

## Dokumenter

| Dokument | Hvad |
|---|---|
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

```bash
cd packages/app
npx eas-cli@latest build --platform android --profile preview --non-interactive --no-wait
```

Profilen `preview` giver en APK der kan deles direkte. **Verificér altid den byggede APK** frem for at antage en rettelse kom med — pak `AndroidManifest.xml` ud af zip-filen og se efter.

Android er gratis hele vejen. **iOS og Apple TV kræver Apple Developer Program, 99 USD/år**, selv til privat brug via TestFlight. TestFlight-builds udløber efter 90 dage.

### Verificér en rettelse **før** du bygger

Den gamle vane var at bygge, hente APK'en og pakke `AndroidManifest.xml` ud af
zip-filen. Den fanger fejlen, men først efter et build og en download. Det
samme kan gøres på et minut uden EAS overhovedet:

```bash
cd packages/app
npx expo prebuild --platform android --no-install
cat android/app/src/main/AndroidManifest.xml   # ren tekst, ikke binær
rm -rf android                                  # ryd op — se nedenfor
```

`prebuild` genererer præcis det native projekt EAS selv bygger, ud fra
`app.json` og pluginnene. Manifestet er læsbar tekst, så `usesCleartextTraffic`,
pakkenavn og rettigheder kan efterses direkte.

**Slet `android/` bagefter.** Bliver mappen liggende og committet, skifter
projektet fra managed til bare workflow, og EAS holder op med at regenerere
den — en langt større ændring end nogen havde bedt om.

Metoden fandt selv en fejl af samme slags som `usesCleartextTraffic`:
`userInterfaceStyle: "dark"` stod i `app.json`, men blev **ignoreret**, fordi
`expo-system-ui` ikke var installeret. Prebuild sagde det højt; et build ville
bare have været grønt.

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
- **Nogle miljøer kan ikke nå `expo.dev` og `api.expo.dev`.** Er de blokeret i
  netværkspolitikken, fejler ethvert EAS-kald med `Forbidden` eller
  `CONNECT tunnel failed, response 403` — det er gatewayen, ikke dit token.
  `curl -sS "$HTTPS_PROXY/__agentproxy/status"` viser afvisningen direkte.
  `dl.google.com` er blokeret samme sted, så Android SDK'et kan heller ikke
  hentes, og APK'en kan ikke bygges lokalt som alternativ.

### Credentials

Brugerens panel-adgangsoplysninger står **ikke** i dette repo og skal ikke skrives ind. Appen gemmer dem i `expo-secure-store` på enheden; på web kun i hukommelsen, aldrig i `localStorage`.

**Bemærk:** Xtream lægger brugernavn og adgangskode i URL-stien, og panelet kører `http`. Credentials sendes altså ukrypteret. Det er panelets vilkår, ikke appens — men det er grunden til at fejlbeskeder aldrig må vise en rå stream-URL.

## Parkerede punkter

1. **EAS-projektets slug hedder stadig `iptv-norlys`** og skal omdøbes manuelt på expo.dev. Omdøbes projektet der til `norstream`, skal `slug` i `app.json` ændres tilsvarende, ellers afvises builds med *"slug does not match"*. Gør begge dele eller ingen af dem.
2. **Den lokale mappe hedder stadig `uhf-play`** — rent kosmetisk. Det samme gælder databasefilens navn `uhf-play.db`, som med vilje er uændret: skiftes det, mister eksisterende installationer deres favoritter, fordi migreringen så ikke finder den gamle database.
3. **Guiden henter 12 programmer per kanal.** Sider man langt frem, løber den tør for data og viser huller. Flere kræver et højere `limit` eller flere kald.
4. **Ingen UI-tests.** `vitest.config.ts` matcher kun `.ts`, ikke `.tsx`. Browserkørslen dækker hullet manuelt, men den er ikke automatiseret.
5. **Kanaler hvis `category_id` ikke peger på en kendt kategori** tælles ikke med i landeoversigten og kan kun findes via søgning.

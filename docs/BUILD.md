# NorStream — sådan bygges appen

Hvordan en installerbar app laves fra denne kodebase, hvad hvert trin gør, og hvilke fælder der har kostet tid.

---

## Hvorfor builds sker i skyen

Udviklingsmaskinen kører Windows og har hverken Java, Android SDK eller Xcode. Det er ikke et problem der kan installeres væk: **iOS- og tvOS-apps kan fysisk ikke bygges på Windows.** Apples værktøjskæde findes kun til macOS.

Derfor bygges der med **EAS Build** — Expos byggetjeneste. Koden uploades, bygges på Expos maskiner, og man får en færdig fil retur. Det var hele grunden til at projektet blev bygget på Expo frem for bar React Native.

| Platform | Koster | Bemærkning |
|---|---|---|
| **Android APK** | Gratis | Deles direkte, ingen Google Play-konto |
| iOS / Apple TV | 99 USD/år | Apple Developer Program, også til privat brug via TestFlight |

EAS' gratis-niveau har en byggekø og et begrænset antal builds om måneden. Rigeligt til dette projekt.

---

## Engangsopsætning

Dette er allerede gjort. Beskrevet her fordi det skal gentages på en ny maskine.

### 1. Log ind

```bash
npx eas-cli@latest login
```

Sessionen gemmes i `~/.expo/state.json` og overlever genstart. **Der skal ikke bruges en `EXPO_TOKEN`** på en maskine hvor dette er gjort — tokens er til byggeservere og CI, der ikke kan logge ind interaktivt.

Tjek altid med `npx eas-cli@latest whoami` før du konkluderer at der mangler adgang.

> En `EXPO_TOKEN` giver **fuld adgang** til Expo-kontoen — bygge, udgive, ændre projekter. Der findes ingen begrænset variant. Skal en bruges, sæt den som miljøvariabel frem for at skrive den i en besked, og rotér den bagefter.

### 2. Forbind projektet

```bash
cd packages/app
npx eas-cli@latest init --id <projekt-id> --non-interactive
```

Skriver id'et ind i `app.json` under `extra.eas.projectId`. Det er den eneste kobling mellem den lokale mappe og projektet på expo.dev.

**Fælde:** `slug` i `app.json` skal matche projektets navn på expo.dev. Gør den ikke det, afvises builden med *"Project slug does not match"*. Omdøbes projektet ét sted, skal det omdøbes begge steder.

---

## Filerne der styrer det hele

### `packages/app/eas.json`

Byggeprofiler. **Uden denne fil bygger EAS ikke.**

```json
{
  "cli": { "version": ">= 16.0.1", "appVersionSource": "remote" },
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal",
      "android": { "buildType": "apk" }
    },
    "preview": {
      "distribution": "internal",
      "android": { "buildType": "apk" }
    },
    "production": {
      "autoIncrement": true,
      "android": { "buildType": "app-bundle" }
    }
  }
}
```

To felter er vigtigere end de ser ud:

- **`distribution: "internal"`** — appen deles direkte frem for gennem en app-butik.
- **`buildType: "apk"`** — uden den bygger EAS en **AAB**. Den kan Google Play bruge, men den kan **ikke installeres på en telefon**. Det er den hyppigste årsag til at en build "lykkes" men er ubrugelig.

`appVersionSource: "remote"` lader EAS tælle versionsnumre, så to builds aldrig kolliderer.

### `packages/app/app.json`

Felterne der har betydning for builden:

| Felt | Hvorfor |
|---|---|
| `name` | Navnet under ikonet på telefonen |
| `slug` | Skal matche projektnavnet på expo.dev |
| `android.package` | Appens entydige id. **Ændres det, ser Android den som en ny app** — den gamle skal afinstalleres |
| `ios.bundleIdentifier` | Samme for Apple |
| `extra.eas.projectId` | Koblingen til EAS |
| `plugins` | Config-plugins der ændrer det native projekt |

**EAS afviser at bygge uden `android.package` og `ios.bundleIdentifier`.**

### Config-plugins: det der faktisk ændrer manifestet

```json
"plugins": [
  "expo-sqlite",
  "expo-secure-store",
  "expo-video",
  ["expo-build-properties", { "android": { "usesCleartextTraffic": true } }]
]
```

**Dette er den vigtigste lektion i hele dokumentet.**

`android.usesCleartextTraffic` blev først sat direkte i `app.json`. Expo *læste* nøglen — den var synlig i `expo config --type public` — men **anvendte den aldrig på AndroidManifest.xml**. Builden lykkedes, APK'en virkede ikke, og fejlen så identisk ud med den forrige.

Den understøttede vej er `expo-build-properties`. Alt der skal ændre native byggeindstillinger, går gennem et config-plugin — ikke gennem løse nøgler i `app.json`.

---

## Verificér lokalt før du bygger

En cloud-build tager omkring ti minutter. Manifestet kan genereres på et sekund:

```bash
cd packages/app
npx expo prebuild --platform android --no-install
grep -n 'usesCleartextTraffic' android/app/src/main/AndroidManifest.xml
```

`prebuild` genererer det native projekt lokalt, så det færdige `AndroidManifest.xml` kan læses som almindelig XML. Mappen `android/` er git-ignoreret og påvirker ikke cloud-builden, som prebuilder selv.

**Gør dette hver gang du ændrer noget nativt.** Det var sådan cleartext-fejlen endelig blev fanget — efter to spildte builds.

---

## Byg

```bash
cd packages/app
npx eas-cli@latest build --platform android --profile preview --non-interactive --no-wait
```

| Flag | Hvorfor |
|---|---|
| `--profile preview` | Profilen fra `eas.json` der giver en delbar APK |
| `--non-interactive` | Kræves når ingen kan svare på dialogbokse |
| `--no-wait` | Returnér straks med et link frem for at blokere i ti minutter |

### Hvad der sker på Expos side

```
✔ Initialized versionCode with 1
✔ Using remote Android credentials (Expo server)
✔ Generating keystore in the cloud
✔ Compressing project files and uploading to EAS Build
✔ Computed project fingerprint
```

**Keystore i skyen.** Android-apps skal signeres. Findes `keytool` ikke lokalt, laver EAS nøglen på deres server og gemmer den. Den genbruges hver gang — afgørende, for skifter signaturen, kan ingen opgradere uden at afinstallere.

**Kun sporede filer uploades.** EAS bruger git til at afgøre hvad der skal med. `node_modules` og ignorerede mapper sendes ikke. En typisk upload er under 2 MB.

**Fingerprint.** Et aftryk af de native afhængigheder, så EAS kan se om et tidligere build kan genbruges.

---

## Følg builden

```bash
npx eas-cli@latest build:list --limit 1 --non-interactive
```

Status går `in progress` → `finished`. Ved `finished` står der en **Application Archive URL** — det er APK'en.

---

## Verificér den færdige APK

**Dette trin er ikke valgfrit.** En build der siger `finished` beviser kun at den byggede, ikke at den indeholder det du troede.

```bash
curl -sL -o app.apk "<artifact-url>"
mkdir -p apkcheck && cd apkcheck
unzip -o -q ../app.apk AndroidManifest.xml
python -c "
import io
d = io.open('AndroidManifest.xml','rb').read()
t = d.decode('latin-1', errors='ignore')
print('usesCleartextTraffic:', 'leartext' in t)
"
```

En APK er en ZIP-fil. Manifestet er binært XML, men attributnavnene ligger som læsbar tekst i strengtabellen, så en simpel søgning afslører om et flag kom med.

**Det var sådan det blev opdaget at `app.json`-nøglen ikke virkede.** Uden kontrollen var der sendt en APK med samme fejl igen — hvilket faktisk skete én gang.

---

## Installér på telefonen

Åbn artefakt-URL'en direkte på telefonen, eller overfør filen via USB.

**Fælder:**

- **Samsung Internet og in-app-browsere fejler ofte på APK'er.** Downloaden viser 100% og skriver aldrig filen. Brug **Chrome**, eller overfør via kabel.
- **Auto Blocker** (Samsung, One UI 6.1+) blokerer al sideloading uafhængigt af andre tilladelser: *Indstillinger → Sikkerhed og privatliv → Auto Blocker*.
- **Play Protect** advarer om ukendte apps. "Installér alligevel" gemmer sig under *Flere detaljer*.
- **Ændret pakkenavn** betyder at Android ser appen som en helt ny. Den gamle skal afinstalleres først.

---

## Fælder der har kostet tid i dette projekt

| Symptom | Årsag | Løsning |
|---|---|---|
| App kan ikke nå panelet | **Android blokerer `http` som standard** siden Android 9. Panelet kører uden TLS | `expo-build-properties` med `usesCleartextTraffic` |
| Rettelsen kom ikke med i APK'en | `android.usesCleartextTraffic` i `app.json` læses men anvendes aldrig | Brug config-pluginet |
| Build afvist: *slug does not match* | `slug` i `app.json` ≠ projektnavn på expo.dev | Ret begge, eller ingen |
| APK kan ikke installeres | `buildType` manglede, så EAS byggede en AAB | `"android": { "buildType": "apk" }` |
| CI fejler efter merge | `node:sqlite` kræver Node 24; workflow pinnede 20 | Hæv Node-versionen i CI |
| App hænger i spinner på web | `expo-secure-store` findes ikke på web | In-memory fallback, kun web |
| Web-bundling fejler på `.wasm` | `expo-sqlite`s web-worker | `config.resolver.assetExts.push('wasm')` |

---

## iOS og Apple TV

Ikke gjort endnu. Kræver:

1. **Apple Developer Program**, 99 USD/år — også til privat brug via TestFlight
2. `npx eas-cli@latest build --platform ios --profile preview`
3. TestFlight til distribution. Testere installerer TestFlight gratis; kun ejeren betaler

**TestFlight-builds udløber efter 90 dage.** Cirka hver tredje måned skal der bygges på ny, og alle skal geninstallere. Android-APK'er udløber aldrig.

**Apple TV kræver desuden at appen kan betjenes med fjernbetjening.** Det er lavet til Android TV (fokusrammer, D-pad, lærred) og gælder også tvOS, men tvOS er ikke prøvet. Alt om tv står i `docs/ANDROID-TV.md`, inklusive hvordan tv-builds laves i workflowet og installeres på en Google TV Streamer.

---

## Den vane der er værd at tage med

Efter hver build der skal indeholde en rettelse: **pak APK'en ud og se efter.**

Det tager ti sekunder, og det er forskellen på at vide at rettelsen kom med og at håbe det. I dette projekt fangede det en fejl der ellers havde kostet en runde mere frem og tilbage — og som så identisk ud med den fejl den skulle have løst.

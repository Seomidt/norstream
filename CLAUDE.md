# NorStream

**Start her: [`docs/OVERDRAGELSE.md`](docs/OVERDRAGELSE.md)** — den fulde
overdragelse. Øverst i den står det nyeste (selv-opdatering, sky-backup,
tv-rettelser); læs det først. Alt andet i `docs/` er detaljer.

## Hurtige fakta

- **Monorepo:** `packages/core` (rent TypeScript, ingen RN-imports),
  `packages/app` (NorStream — Expo SDK 57, React Native 0.86 + react-native-tvos),
  `packages/radio` (NorRadio, med Android Auto).
- **Samme kode kører på telefon OG Android TV.** Læs `docs/ANDROID-TV.md`
  (lærred, fokus, fælder) før du ændrer noget der tegnes eller får fokus.
- **Builds laves via GitHub Actions, aldrig EAS.** Fremgangsmåde i
  `docs/BYG-FRA-CHAT.md`. `build-android.yml` bygger; `android/` er
  git-ignoreret og laves af `expo prebuild`.
- **Appen opdaterer sig selv uden Play Store:** `build-android.yml` bygger,
  `udgiv-apk.yml` (på `main`) udgiver APK'en under faste mærkater
  (`latest-norstream`, `latest-norstream-tv`, `latest-norradio`). **Hæv
  `expo.android.versionCode` i `packages/app/app.json` ved hver ny udgave.**
  Opskrift: `docs/BYG-FRA-CHAT.md` afsnit 9.
- **Sikkerhedskopi = Google Drev** (eneste vej): Indstillinger → Gem i skyen.
  Login med enhedskode (google.com/device). Detaljer i `OVERDRAGELSE.md`.
- **Vis aldrig rå stream-/afspilningsfejl eller -adresser** (adressen har
  panelets kodeord). Ingen rigtige credentials i commits, logs eller chat.
- **Kommunikationen med brugeren er på dansk.** Kommentarer og commits på
  dansk med ae/oe/aa; docs og UI-tekster med rigtige æ/ø/å.

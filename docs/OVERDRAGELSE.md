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
efterhånden som det skal være". Nyeste builds: **tv 212, telefon 213,
NorRadio 217** (GitHub Actions, `build-android.yml`); de rummer alt det
nye i afsnittet nedenfor, som ikke er prøvet på enhed endnu. Alt bygges via
GitHub, aldrig EAS; se `docs/BYG-FRA-CHAT.md`.

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

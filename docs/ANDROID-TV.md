# NorStream på Android TV og Google TV

Alt det der skal være rigtigt for at appen virker på et fjernsyn, samlet ét
sted. Læs den før du rører noget der tegnes på skærmen, og før du bygger
til tv. Telefonen og fjernsynet kører **samme kode**; forskellen er
byggeflaget, lærredet og fjernbetjeningen.

Verificeret på en Google TV Streamer (2024) på et Bang & Olufsen-fjernsyn i
1080p, med tv-build 136 (september 2026). Apple TV er ikke prøvet, se
nederst.

## 1. Hvordan tv-udgaven bliver til

- `react-native-tvos` erstatter `react-native` i `packages/app`. Den giver
  `Platform.isTV`, fokus-hændelser (`onFocus`/`onBlur`) og D-pad-navigation.
  På telefonen er den identisk med almindelig React Native.
- `@react-native-tvos/config-tv` er config-plugin i `app.json`. Den læser
  miljøvariablen `EXPO_TV` under prebuild og sætter, når den er `1`:
  leanback-launcher (så appen står på fjernsynets startskærm), tv-banneret
  (`assets/tv-banner.png`, 320 × 180) og *intet krav om berøringsskærm*.
- Derfor bygges **to APK'er**: `norstream-apk` til telefonen og
  `norstream-tv-apk` til fjernsynet. En telefon-APK kan installeres på et
  tv, men den står ikke på startskærmen og kan ikke findes af launcheren.

### Byg

Workflowet `.github/workflows/build-android.yml`, kør med `workflow_dispatch`:

| Input | Værdi til tv |
|---|---|
| `motor` | `runner` (EAS-vejen bruger profilerne `*_tv` og er ikke prøvet) |
| `app` | `app` |
| `tv` | sæt flueben |
| `profile` | `preview` |
| `platform` | `android` |

Artefaktet hedder `norstream-tv-apk`. Workflowet fejler med vilje, hvis
manifestet mangler `LEANBACK_LAUNCHER` eller `res/drawable/tv_banner.png`:
så har pluginet ikke kørt, og APK'en er en telefon-APK med forkert navn.

**`EXPO_TV` skal være `'1'` eller `'0'`, aldrig tom.** Pluginet læser den
som boolean og går ned på en tom streng (`GetEnv.NoBoolean`). Workflowet
skriver `${{ inputs.tv && '1' || '0' }}` af netop den grund.

## 2. Installér på en Google TV Streamer

1. På fjernsynet: Indstillinger → Privatliv → Sikkerhed og begrænsninger →
   Ukendte apps → slå til for den app du sender filen med (fx "Send files to
   TV"). Menuen hedder lidt forskelligt fra version til version, men den
   ligger under Privatliv, ikke under Apps.
2. Hent `norstream-tv-apk` fra byggets Artifacts på GitHub, pak zip-filen ud.
3. Installér "Send files to TV" på både telefon og fjernsyn (Google Play),
   send APK'en fra telefonen, og åbn den fra fjernsynets side, når den er
   modtaget. Første gang spørger fjernsynet om lov til at installere fra
   den app; sig ja.
4. Opgradering: samme fremgangsmåde. Android nægter kun, hvis signaturen er
   en anden; alle runner-builds har samme signatur.
5. Luk en app helt: Indstillinger → Apps → Se alle apps → appen → Tving stop.
   Der er ingen "luk alle" på Google TV.
6. Legitimation til panelet uden at taste på fjernbetjeningen: Google
   Home-appen på telefonen → fjernsynet → fjernbetjening → tastatur. Der kan
   indsættes fra udklipsholderen, og feltet på fjernsynet får teksten.

### Se hvad der sker (adb)

Fjernsynet: Indstillinger → System → Om → tryk 7 gange på "Android TV
OS-build" → Udviklerindstillinger → "Fejlretning via netværk". Så viser den
en IP-adresse. På en pc med Android platform-tools:

```
adb connect <fjernsynets ip>:5555
adb exec-out screencap -p > tv.png
adb logcat -s ReactNativeJS:V AndroidRuntime:E
```

Skærmbilledet er det eneste der viser hvad appen *faktisk* tegner. Fotos af
fjernsynet er bedre end ingenting, men perspektivet snyder.

## 3. Lærredet: sådan tegnes appen på fjernsynet

Alt ligger i `packages/app/src/ui/tv.ts` og `packages/app/App.tsx`.

Appen er tegnet til en telefon. På tv tegnes den derfor på et **mindre
lærred, som skaleres op**, så skrift, logoer og afstande bliver større uden
at hver eneste stil skal ændres:

| Konstant | Værdi | Hvad |
|---|---|---|
| `TV_SCALE` | 1,2 | Lærredet er 1/1,2 af fladen og skaleres 1,2 gange op |
| `TV_SAFE_MARGIN` | 0,05 | 5 % fri kant hele vejen rundt (Googles anbefaling til overscan) |

På en 1080p-skærm melder Android 960 × 540 punkter. Lærredet bliver
`960 × 0,9 / 1,2 = 720` punkter bredt og `540 × 0,9 / 1,2 = 405` punkter
højt. **405 punkter i højden er hele budgettet**, og menulinjen nederst
tager de 50. Enhver skærm skal kunne stå i det.

Regler der er blevet til af fejl:

1. **Lærredet ligger absolut med fast bredde *og* højde.** Det må ikke have
   `flex: 1` sammen med højden: i Yoga slår `flex: 1` (flexBasis 0 + vokse)
   den faste højde, så lærredet blev lige så højt som hele fladen og efter
   skaleringen halvanden gang højere. Menulinjen lå langt under skærmens
   kant, mens bredden (tværaksen) passede. Det kostede fire builds, fordi det
   lignede overscan på fjernsynet.
2. **Fladen måles med `onLayout` på det yderste lag** og lægges i
   `CanvasContext`. Skalering sker om lærredets midte, så det flyttes først
   ind i fladens midte og vokser derfra ud.
3. **Brug `useCanvasSize()`, aldrig `useWindowDimensions()`, til
   layoutvalg.** Vinduet melder hele skærmen; appen har kun lærredet. Med
   vinduets bredde valgte guiden tv-opstillingen uden at have plads, og
   previewet i kanallisten fyldte 16:9 af lærredets bredde, som er hele
   lærredets højde: kanallisten lå under menulinjen ("der kommer ingen
   kanaler"). `width > height` til landskab/portræt er i orden med begge.
4. **Bred skærm er ≥ 700 punkter** (`guideTopLayout` i
   `features/guide/nowNext.ts`). Tv, tablet og foldet telefon slået ud er
   brede: guiden og kanallisten lægger previewet til højre (42 % af bredden)
   og giver listen hele højden. Smal skærm stabler. Brug samme grænse til
   nye skærme, så tv'et ikke får sin egen, tredje opstilling.
5. **Ingen faste højder fra vinduet.** Højder i procent af lærredet eller
   `flex` er fine; `Dimensions.get('window').height * 0.4` er ikke.

## 4. Fjernbetjeningen

På tv findes ingen fingre. Der findes fokus, pile, OK og Tilbage.

- **Alle trykflader er `TvPressable`** (`src/ui/TvPressable.tsx`), aldrig
  en rå `Pressable` eller `TouchableOpacity`. Den viser en bred ramme i
  appens farve, en lysere flade og en anelse forstørrelse, når fokus står
  på den. Uden den ved man ikke hvad OK rammer; det var den første klage
  fra sofaen. På telefonen er den en almindelig `Pressable` uden ekstra
  stil.
- **Alle tekstfelter er `TvTextInput`** af samme grund.
- **Fanerne nederst skifter på fokus** (`onFocus` når `isTV`), ikke på OK.
  Sådan gør de andre tv-apps, og "tryk OK for at se Film" føltes som om
  intet skete.
- **Enter i sidste felt sender formularen** (onboarding: "Forbind"), fordi
  knappen ellers ligger for langt væk at navigere til.
- **Lange lister:** `FlatList` ruller selv til den fokuserede række. Rækker
  skal være `TvPressable`, ellers springer fokus over dem, og listen kan
  ikke rulles med pilene.
- **Ingen trækfinger.** Trækfladen i guiden (`PanResponder`) virker ikke på
  tv; derfor findes dagsknapperne og bladreknapperne ‹ ›. En ny skærm der
  kun kan betjenes med træk eller lang-tryk, er brudt på tv.
- `RefreshControl` (træk ned for at opdatere) kan ikke nås med
  fjernbetjeningen. Alt der ligger bag den, skal også kunne nås fra en knap.
- `Alert.alert` bruges ikke (heller ikke på telefonen); brug `Notice`.

## 5. Tjekliste før et tv-build

1. `npm run typecheck --workspace @norstream/app` og `npm test`.
2. Grep: `grep -rn "useWindowDimensions\|Dimensions.get" packages/app/src`
   må kun give `width > height`-brug. `grep -rn "<Pressable\|Touchable"`
   må ikke give noget uden for `TvPressable.tsx`.
3. Regn højden ud for den skærm du har ændret: passer den i 405 − 50
   punkter, inklusive alle rækker knapper? Hvis ikke, læg ting ved siden
   af hinanden, når `useCanvasSize().width ≥ 700`.
4. Byg med `tv` slået til, og bed om et foto (eller adb-skærmbillede) af
   præcis den skærm. Der er ingen emulator i kæden endnu; det eneste der
   verificerer et tv-layout, er fjernsynet.

## 6. Fælder der har kostet tid

| Symptom | Årsag | Rettelse |
|---|---|---|
| Menulinjen nederst usynlig, billedet "for stort" | `flex: 1` + fast højde på lærredet | Lærredet absolut, uden flex |
| Samme, uanset 720p/1080p på Streameren | Appen regner i punkter, ikke pixels; opløsningen ændrer intet | Lad Streameren stå på Automatisk |
| Ingen kanaler under en kategori | Previewet 16:9 af vinduesbredden fyldte hele højden | `useCanvasSize` + preview til højre |
| Guiden: knapper oven i hinanden, intet gitter | Tv-opstilling valgt efter vinduet, ikke lærredet; for lidt højde | Samme; bladre- og dagsknapper på én linje |
| Ingen ramme om det fokuserede | Rå `Pressable` | `TvPressable` |
| Onboarding: "Forbind" kan ikke nås | Lodret formular højere end lærredet | Side om side på bred skærm, Enter sender |
| Tv-plugin går ned i prebuild | `EXPO_TV: ''` | `'1'`/`'0'` |
| APK'en er en telefon-APK | Pluginet kørte ikke | Workflowets manifest-tjek fejler bygget |
| Trailere "kan ikke vises" | `webViewMissing` gjaldt alle tv | Kun tvOS mangler WebView; Android TV har den |

## 7. Hvad der ikke er gjort

- **Apple TV.** Kræver Apple Developer Program og en macOS-bygger (EAS).
  Koden er klar til det (samme `react-native-tvos`), men intet er prøvet.
  WebView findes ikke på tvOS, så trailere og alt andet der bruger
  `WebView`, skal have en anden vej der.
- **Emulator i byggekæden.** Et Android TV-emulatorjob på GitHub, der
  installerer APK'en og tager skærmbilleder, ville have fanget alle fejlene
  i afsnit 6 før de nåede fjernsynet. Ikke sat op endnu.
- **Skriftstørrelsen** er valgt på øjemål fra fotos. Hvis 1,2 er for småt
  fra sofaen, er `TV_SCALE` det eneste sted der skal ændres, men hver
  tiendedel koster højde på lærredet.
- **Google Play.** Kræver AAB, egen signeringsnøgle og tv-gennemgang hos
  Google (bl.a. banner, fokus på alt, ingen krav om berøring). Se
  `docs/BUILD.md`.

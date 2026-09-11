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
| `TV_SCALE` | 1,0 | Lærredet er fladen minus den frie kant; ingen forstørrelse. 1,5 og 1,2 var "alt for stort" fra sofaen |
| `TV_SAFE_MARGIN` | 0,015 | 1,5 % fri kant hele vejen rundt. Google anbefaler 5 % mod overscan, men fjernsynet viser hele billedet, og 5 % var en bred sort ramme |

På en 1080p-skærm melder Android 960 × 540 punkter. Lærredet bliver
`960 × 0,97 = 931` punkter bredt og `540 × 0,97 = 524` punkter højt. Menuen
er en søjle til venstre på 84 punkter (44 når den er foldet), så indholdet
har omkring 850 × 524. **524 punkter i højden er hele budgettet.** Enhver skærm skal kunne stå
i det.

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
   brede: guiden og kanallisten lægger previewet til højre og giver listen
   hele højden. Previewets andel er `sidePreviewFraction(isTV)`: 42 % på
   tablet, 30 % på tv, for med 42 % fik guiden én række tilbage. Smal
   skærm stabler. Brug samme grænse til nye skærme, så tv'et ikke får sin
   egen, tredje opstilling.
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
- **Fanerne er en søjle til venstre på tv** (`rail` i `HomeScreen`), ikke
  en linje nederst: fra en liste på hundrede rækker var menulinjen nederst
  hundrede tryk væk, til venstre er den ét tryk på pil-venstre. De skifter
  på fokus (`onFocus` når `isTV`), ikke på OK. Sådan gør de andre tv-apps,
  og "tryk OK for at se Film" føltes som om intet skete.
- **Fanerne skifter på fokus kun efter et rigtigt tryk, og først efter
  250 ms.** Forsvinder den række der havde fokus (en favorit fjernet),
  flytter Android selv fokus til det første trykpunkt, som er Hjem i
  søjlen; derfor tæller kun fokus der kom inden for 600 ms efter et tryk
  på fjernbetjeningen (`useTVEventHandler`). Ventetiden gør at man kan
  køre hen over fire faner uden at montere fire skærme. Af samme grund
  bliver en fjernet favorit stående med hul stjerne til man forlader fanen.
- **Previewet følger fokus på tv**, ikke den øverste synlige række, og har
  lyd fra start. Gælder kanallisten og guidens kanalkolonne.
- **Blade (`Modal`) skal sende fokus til den første knap**
  (`hasTVPreferredFocus`) og gøre bagtæppet ufokuserbart, ellers lander OK
  på bagtæppet og lukker bladet.
- **Afspilleren bruger appens egne knapper på tv** (`nativeControls={!isTV}`):
  afspillerens indbyggede tog fjernbetjeningen, så Tilbage først lukkede
  dem. Ethvert tryk viser bjælken igen.
- **Menusøjlen folder sig sammen** til ikoner to sekunder efter at
  fjernbetjeningen har forladt den, og folder sig ud ved pil-venstre.
- **Guiden på tv:** gitteret holder på fokus til begge sider
  (`TVFocusGuideView trapFocusRight trapFocusLeft`), og kanalcellen med
  logoet kan ikke få fokus; pil-højre på den sidste udsendelse i en række
  flytter vinduet en time frem, pil-venstre på den første en time tilbage,
  og fokus bliver på samme udsendelse (`focusTarget` +
  `hasTVPreferredFocus`). Menuen nås fra dagsknapperne over gitteret. Søjlen til højre (`NowNextBox
  rich`) har ingen knapper: den kan ikke nås når gitteret holder på fokus,
  og OK på udsendelsen giver de samme valg (se kanalen, start forfra, hele
  dagen).
- **Langt tryk på OK på en kanal er favorit til/fra.** Stjernen i rækken
  er ikke fokuserbar på tv (`focusable={!isTV}`): et trykpunkt inde i et
  trykpunkt var ikke til at ramme. Listerne siger det i en linje øverst.
- **En Switch kan ikke få fokus.** Læg den i en `TvPressable`-række der
  skifter den ved tryk, og sæt `focusable={false}` på selve kontakten.
- **Intet træk-ned på tv.** "Hent kanaler, film og serier nu" står under
  Indstillinger → Kilder, og fejler hentningen af film, står fejlen der
  (`last_vod_error:<kilde>`), uden adresser.
- **Enter i sidste felt sender formularen** (onboarding: "Forbind"), fordi
  knappen ellers ligger for langt væk at navigere til.
- **Lange lister:** `FlatList` ruller selv til den fokuserede række. Rækker
  skal være `TvPressable`, ellers springer fokus over dem, og listen kan
  ikke rulles med pilene. Men Android ruller kun så rækken er inden for
  listens *egne* kanter, og er listen højere end det synlige (lærredet
  klipper), ligger de nederste rækker "inde i listen" men uden for
  skærmen. Derfor holder listerne på tv den fokuserede række i midten
  (`keepInMiddle` i `src/ui/tvScroll.ts`, kaldt fra rækkens `onFocus`) og
  har luft nederst (`useTvListTail`), så også den sidste række kan nå
  midten. Brug det i enhver ny liste.
- **Indstillinger på tv viser kun det der bruges der:** ingen logovalg,
  Google-nøgler, YouTube-nøgle eller sikkerhedskopi (`!isTV`), og ingen
  tekster om "telefonen". Streamingtjenesterne er foldet sammen.
- **Fokus overlever ikke at en række flytter sig.** Bygger listen rækken
  om (sortering, en fjernet favorit), går fokus til Færdig eller til Hjem i
  søjlen. Giv den knap der skal beholde fokus en ny `key` per flyt og
  `hasTVPreferredFocus`, som i favoritternes `SortView`. Og brug aldrig
  `disabled` på en knap der kan have fokus: en deaktiveret knap kan ikke
  have fokus, så fokus røg samme sekund kanalen nåede toppen.
- **Sortering på tv er "tag op, flyt, sæt":** OK på rækken tager kanalen
  op, pil op/ned flytter den (samme `drag`-tilstand som fingeren, så intet
  bygges om undervejs), OK sætter den. Imens er alle andre rækker og
  Færdig `focusable={false}` og listen ligger i en `TVFocusGuideView` der
  fanger fokus i alle retninger, ellers gik pil op til Hjem i søjlen.
  Pilene læses med `useTVEventHandler` (kun `eventKeyAction` 1, ellers
  tæller hvert tryk dobbelt). En knap per plads (▲/▼) var for langsomt.
- **Pil højre fra menuen giver den første række fokus.** HomeScreen
  tæller `enterSignal` op når pil højre trykkes mens søjlen har fokus
  (eller inden for 400 ms efter den mistede det: Android flytter fokus ved
  tryk ned, før tryk op når til JS), og Favoritter, Kanaler og Guide giver
  deres første række/celle `hasTVPreferredFocus` i én tegning (falsk →
  sand → falsk via `requestAnimationFrame`). **Aldrig med en ny `key`:**
  et view der tegnes forfra kan få anmodningen før det sidder i vinduet,
  fokus går tabt, og Android sætter det øverst i hjørnet.
  Previewet kan ikke få fokus på tv (`focusable={!isTV}`) og følger den
  række der har fokus, aldrig den øverste synlige.
- **Knapper der skal kunne nås fra en lang liste, står i højre søjle**
  under previewet (`sidePanel` på `ChannelList`), ikke over listen: fra
  bunden af halvtreds favoritter var Sortér halvtreds tryk væk; til højre
  er den ét. Tilbage afslutter sorteringen (`BackHandler` i `SortView`).
- **Afspillerne er altid mørke** (`ThemeProvider scheme="dark"` om
  ruterne i App.tsx): bjælken er sort, og med det lyse temas næsten sorte
  fokusring og lyse toning forsvandt den knap man stod på. Fokustoningen
  ligger desuden som et lag oven på knappens egen farve, ikke i stedet for.
- **Start forfra bruger samme beholder som live** (`formatForPlatform()`
  til `buildTimeshiftUrl`): arkivet som HLS gav grøn skærm med lyd på
  DR-kanalerne, mens live i `.ts` var fint.
- **Åbner en skærm med OK, skal dens første række have
  `hasTVPreferredFocus`** — regnet ud én gang ved montering
  (`useRef(isTV && cameBySelect()).current`), ikke ved hver tegning:
  ellers sprang fokus tilbage til første række ved næste OK-tryk, og et
  langt tryk på OK (favorit til/fra under Kanaler) er også et OK-tryk:
  "springer til toppen hver gang". Aldrig `cameBySelect()` direkte i JSX.
- **Ingen trækfinger.** Trækfladen i guiden (`PanResponder`) virker ikke på
  tv; derfor findes dagsknapperne og bladreknapperne ‹ ›. En ny skærm der
  kun kan betjenes med træk eller lang-tryk, er brudt på tv.
- `RefreshControl` (træk ned for at opdatere) kan ikke nås med
  fjernbetjeningen. Alt der ligger bag den, skal også kunne nås fra en knap.
- `Alert.alert` bruges ikke (heller ikke på telefonen); brug `Notice`.

## 4b. Farver og tema

Appen har to temaer, mørkt og lyst (`src/ui/theme.ts`), og følger solen
som standard (`src/ui/themeMode.ts`, solberegning i `src/ui/sun.ts`): lyst
fra solopgang til solnedgang, mørkt ellers, også på tv. Under Indstillinger
→ Tema kan man vælge Følg solen, Følg telefonen (kun telefon), Mørk eller
Lys, og stedet solen regnes for.

- **Ingen `theme.colors` i skærme.** Farverne læses gennem
  `useTheme()` og stilark bygges med `useStyles(makeStyles)`, hvor
  `makeStyles = (colors: ThemeColors) => StyleSheet.create({...})`. Et
  stilark på modulniveau er bygget ved opstart og skifter aldrig.
  `theme.spacing` og `theme.radius` er stadig faste.
- **Nye farver hører til i `ThemeColors`** med en værdi i begge paletter.
  Hårdkodede farver er kun i orden oven på video, plakater og sort
  (afspillerne, trailere, plakatoverlæg).
- **Logoer får en mørk plade bag sig** (`colors.logoBackdrop`): mange
  kanallogoer er hvide på gennemsigtig bund og forsvinder på lyst.
- **Fokusrammen** er `colors.focusRing`: hvid på mørkt, næsten sort på lyst.
- NorRadio har ingen `ThemeProvider` og er derfor altid mørk; de delte
  skærme (InternetRadio, RadioView) virker begge steder.

## 5. Tjekliste før et tv-build

1. `npm run typecheck --workspace @norstream/app` og `npm test`.
2. Grep: `grep -rn "useWindowDimensions\|Dimensions.get" packages/app/src`
   må kun give `width > height`-brug. `grep -rn "<Pressable\|Touchable"`
   må ikke give noget uden for `TvPressable.tsx`.
3. Regn højden ud for den skærm du har ændret: passer den i 486
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
| Guiden viser én række | Preview 42 % af bredden åd højden | 30 % på tv, bladre- og dagsknapper på én linje |
| Menuen nederst kan ikke nås | Hundrede rækker mellem listen og menuen | Menuen som søjle til venstre |
| Favorit kan ikke fjernes | Stjernen var et trykpunkt inde i rækken | Langt tryk på OK |
| Film-fanen tom, forsiden mangler rækker | VOD-hentningen fejlede stille | Fejlen gemmes og vises under Kilder; "Hent"-knap |
| Indstillinger kan ikke rulles helt ned | Switch-rækken kunne ikke få fokus | Rækken er en `TvPressable` |
| Kanaler/lande: bunden af listen kan ikke nås | Rækken var inde i listen, men under lærredets kant | Fokus holdes i midten (`keepInMiddle`) + luft nederst |
| Sortér favoritter: fokus ryger ved hvert flyt, åbner på Hjem | Rækken bygges om; `disabled` knap kan ikke have fokus; ingen foretrukket fokus ved åbning | Tag op/flyt/sæt med OK og pile; fokus fanget imens; første række foretrukket ved åbning |
| Plakater der er på telefonen mangler på tv | En forkert TMDB-nøgle en tid: "svar 401" blev gemt som "findes ikke" i 30 dage | Fejl gemmes ikke som nej; nøgleskift og "Hent … nu" glemmer de gamle nej |

## 7. Hvad der ikke er gjort

- **Apple TV.** Kræver Apple Developer Program og en macOS-bygger (EAS).
  Koden er klar til det (samme `react-native-tvos`), men intet er prøvet.
  WebView findes ikke på tvOS, så trailere og alt andet der bruger
  `WebView`, skal have en anden vej der.
- **Emulator i byggekæden.** Et Android TV-emulatorjob på GitHub, der
  installerer APK'en og tager skærmbilleder, ville have fanget alle fejlene
  i afsnit 6 før de nåede fjernsynet. Ikke sat op endnu.
- **Skriftstørrelsen** er valgt på øjemål fra fotos. 1,0 er Googles
  anbefaling; skal den op, er `TV_SCALE` det eneste sted der skal ændres,
  men hver tiendedel koster højde på lærredet.
- **Google Play.** Kræver AAB, egen signeringsnøgle og tv-gennemgang hos
  Google (bl.a. banner, fokus på alt, ingen krav om berøring). Se
  `docs/BUILD.md`.

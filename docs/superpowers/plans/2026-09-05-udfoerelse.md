# Udførelseslog — Plan 1 (EPG og guide) og Plan 2 (navigation)

**Dato:** 2026-09-05
**Branch:** `claude/read-overdragelse-docs-jgous9`
**Spec:** `docs/superpowers/specs/2026-09-05-navigation-og-epg-design.md` (læst)
**Planer:** `2026-09-05-epg-og-guide.md`, `2026-09-05-navigation.md`

Begge planer er skrevet og eksekveret i samme omgang, fordi brugeren vil have
begge dele med i næste APK og kun teste én gang.

---

## Udgangspunkt

165 tests grønne (72 app, 93 core), typecheck rent. Målt før første ændring, så
tallene bagefter betyder noget.

## Afvigelser fra spec'en

Seks i alt. Hver enkelt står med sin begrundelse i den plan den hører til;
her er hvad de koster hvis de er forkerte.

| # | Afvigelse | Hvis den er forkert |
|---|---|---|
| 1 | Base64 skrevet fra bunden i stedet for `atob` | ~60 linjer mere kode at vedligeholde. Alternativet var mojibake på hver dansk programtitel. |
| 2 | Cache-regel 1 læst som "ikke hentet" | En kanal panelet mister EPG for henter først igen efter 30 minutter i stedet for straks. Alternativet var et panel-kald ved hver rendering for hver kanal uden EPG. |
| 3 | Migreringen bevarer `timeshift_dialect` | Intet — den kan altid slettes igen. Alternativet var at alle eksisterende installationer mistede start-forfra permanent. |
| 4 | `favorite_exclusions` er ny og står ikke i spec'en | En tabel mere. Alternativet var at "opdatér" fortryder brugerens oprydning hver gang. |
| 5 | Guiden pager i stedet for at scrolle vandret | Man kan ikke svippe gennem aftenen. Alternativet var to lodrette lister holdt synkroniseret i hånden. |
| 6 | Landeudledningen springer ét markør-ord over | `VIP HD DENMARK` havner under Øvrige. Grænsen er sat med vilje: mere gætteri koster forkert gruppering. |

Nummer 3 og 4 er fundet af koden selv, ikke ved læsning — 4 af en test der
fejlede første gang den kørte.

## Beslutninger undervejs

**Panelets tidszone læses ikke af `timezone`-strengen.** Spec afsnit 8 peger på
`server_info.timezone` (målt: `Europe/Amsterdam`). At omsætte et IANA-zonenavn
til et offset kræver `Intl` med vilkårlig zone, som Hermes ikke leverer
pålideligt på Android. `time_now` minus `timestamp_now` giver det samme svar
med ren aritmetik, og begge felter var i svaret i forvejen. Rundes til nærmeste
kvarter og klampes til ±14 timer.

**EPG-cachen kører højst fire kald parallelt.** Panelets `max_connections: 1`
gælder streams, ikke `player_api.php`, men en ubegrænset fan-out over en synlig
guideside ville stadig være uartig mod et panel der er langsomt nok til at have
en 98 MB XMLTV-fil.

**`XtreamAuthError` kastes videre ud af `ensureEpg`; alt andet sluges per
kanal.** Appen skal kunne logge brugeren ud, men én død kanal må ikke tage
programdata fra resten af skærmen.

**Integrationstesten er skrevet om, ikke slettet.** Den bevogtede koblingen
`epg_channel_id` ↔ XMLTV. Nu bevogter den `stream_id` ↔ `programmes.channel_id`
og sender `epg_channel_id` som **tom streng**, så den ville fejle hvis koden
faldt tilbage på det gamle felt. Panelet sender `stream_id` som tal i
`get_live_streams` og som streng i URL'en; det er den skridning testen findes
for at fange.

**Databasefilens navn er uændret (`uhf-play.db`).** Skiftes det, finder
migreringen ikke den gamle database, og eksisterende installationer mister
deres favoritter uden at nogen opdager det.

## Verifikation

Typecheck og tests beviser ikke at en React Native-app virker. Fire ting blev
gjort ud over dem.

### 1. Bundlen bygger

`npx expo export --platform android` → 661 moduler, Hermes-bytekode produceret.
Det beviser at Metro kunne resolve hver eneste import, og at Hermes accepterede
koden. **Skal køres fra `packages/app`** — fra roden fejler den på entry-punktet.

### 2. Appen booter

Web-bundlen serveret og indlæst i Chromium: onboarding tegnes, ingen fejl i
konsollen.

### 3. Hele brugerfladen kørt igennem mod et falsk panel

Et lille Node-HTTP-panel svarer på `player_api.php` med realistiske former: fem
kategorier med landepræfiks (inkl. `VIP GERMANY` og `4K UHD 3840P`), syv kanaler,
`get_short_epg` med base64-titler indeholdende `æøå` og epoch-sekunder, og
`server_info` med `time_now`/`timestamp_now` to timer foran UTC. Streams svarer
404 — der er ingen video.

Kørt igennem: onboarding → favoritter (tom tilstand) → landeliste med flag og
antal → kategorier i Danmark → "tilføj alle" → kanalliste med nu-titler →
søgning på tværs → favoritter → guidegitteret → sideskift i guiden →
indstillinger → skjul land → søgning finder stadig det skjulte lands kanal →
"vis igen" → forhåndsvisning fra → udlogning.

Alt korrekt. Guiden tegnede fire halvtimeskolonner med den kørende celle
fremhævet, de kommende dæmpede, og kanalnavnene i en fast venstrekolonne.
Side 2 viste ét program og derefter et hul, fordi panelets EPG holdt op der —
netop det gap-celler findes for.

### 4. Fire fejl fundet, som hverken typecheck eller tests så

| Fejl | Hvorfor den var stille |
|---|---|
| **Mini-previewet fangede kun en afvist `replaceAsync`, ikke en `error`-status.** På en stream panelet nægter kommer beskeden som status et øjeblik senere. Previewet fejlede derfor stille, og spec sec.7's krav om en forståelig besked var ikke opfyldt. | Ingen test rører expo-video. Kun en rigtig afspiller mod en rigtig 404 viser det. |
| **`Alert.alert` er ikke implementeret i react-native-web.** Skjul-land, tilføj-alle og log-ud gik alle gennem en Alert og døde stille på web. | Koden er korrekt på Android. Fejlen findes kun ved at bruge appen på den flade hvor Alert ikke findes. |
| **`replaceAsync` afviser på en frigivet afspiller** — altså hver gang skærmen forlades — hvilket gav en uhåndteret rejection. | Ville være en redbox i udvikling og et tabt tryk i produktion. |
| **Afspilleren åbnede live-URLen først og skiftede derefter til arkivet.** På et panel med én forbindelse ville arkiv-streamen blive afvist af den stream vi selv lige havde åbnet. | Præcis den begrænsning spec'en advarer om, indført af koden der skulle respektere den. |

Den første er verificeret rettet på den eneste måde der tæller: beskeden var
der ikke før ændringen, og den er der efter, efter genforsøget.

Alle tre `Alert`-kald er erstattet af `src/ui/Notice.tsx` — en notits i selve
skærmen med en valgfri "Fortryd" — og udlogning af en to-trins bekræftelse.
Det er også bedre end en modal: den afbryder ikke, og den kan tages tilbage.

## Resultat

| | Før | Efter |
|---|---|---|
| Tests i `core` | 93 | 153 |
| Tests i `app` | 72 | 145 |
| I alt | **165** | **298** |

Typecheck rent i begge pakker. CI's to ekstra porte holder: `packages/core`
importerer intet platform-specifikt og har ingen runtime-dependencies.

`syncEpg.ts` og dens test er slettet. `ChannelListScreen.tsx` er delt op i
`ChannelList` plus de fire skærme.

## Hvad der stadig ikke er afprøvet

Skrevet ud, så ingen tror det er dækket:

- **Intet er kørt mod brugerens rigtige panel.** Alt panel-samspil er afprøvet
  mod en lokal efterligning bygget ud fra spec'ens målinger.
- **Ingen video er afspillet.** Afspilning, start-forfra og mini-previewets
  lykkelige vej er uafprøvede i praksis.
- **Migreringen fra v1 er kun kørt mod `node:sqlite`,** ikke mod `expo-sqlite`
  på en enhed med rigtige data. Migreringstesten bygger sit v1-skema fra en
  kopi, ikke fra den kode den tester, så den tester noget — men den kører ikke
  på den rigtige database-implementering.
- **Timeshift-dialekten er ikke probet mod et rigtigt panel** med det nye
  offset. Probingen prøver ±13 timer, så et forkert offset burde ikke slå
  start-forfra fra, men det er ræsonnement, ikke en måling.
- **Skærmkomponenterne har ingen enhedstests.** Den logik der kunne trækkes ud
  af dem — guidens layout, landeudledningen, cache-reglerne — er testet hver
  for sig. Browserkørslen dækker resten manuelt, men er ikke automatiseret.

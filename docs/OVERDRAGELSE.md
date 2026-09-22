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

### 22. september 2026 — v310: favoritter forsvinder ikke længere når id'er skifter (LÆS DENNE FØRST)

Brugeren tilføjede en ny testfil ved siden af sin faste ("Hakuna"), og
**hele hans favoritliste var væk** bagefter. Guiden viser kun favoritter, så
guiden stod også tom. Rod: en favorit pegede kun på kanalens id
(`kilde:kanal-id`). Skifter panelet sine `stream_id`'er — eller udleder en
M3U dem anderledes efter en opdatering — findes kanalen ikke længere under det
id, og favoritten forsvandt stille (listen bygges fra kanalerne).

Rettelse (skema v23): `favorites.match_key` gemmer kanalens normaliserede
navn på selve favoritten. `relinkOrphanedFavorites` (kaldt ved hver synk)
gen-hægter en forældreløs favorit til kanalen med **samme navn i samme kilde**.
Migrationen fylder navnet ud for eksisterende favoritter hvis kanal stadig
findes; favoritter hvis kanal allerede var væk kan ikke reddes af koden (navnet
stod kun på kanalen) og skal hentes fra en sky-backup — gendan matcher på navn.

Se også v309 (kanaler grupperet efter fil; fravalgt fil ryddes ved næste hentning).

### 21. september 2026 — v305: XMLTV/EPG-filer tilbage igen

XMLTV blev fjernet i v299 (frøs appen), men det tog **for meget EPG** med:
brugeren manglede programoversigt på de mange kanaler panelet ikke selv har
data til — dem fyldte EPG-filen. Frysningen er rettet (v298: læses i bidder), så
funktionen er **taget ind igen** (git-revert af v299). Konkret er tilbage:
`syncXmltv.ts` (med chunked-parsing), `maybeXmltv` i `syncAll.ts` (sætter "sidst
hentet" før hentningen), XMLTV-felterne i UI (onboarding + Redigér panel/M3U),
og at sky-gendan tager XMLTV med. De gemte EPG-adresser lå urørt i databasen, så
oversigten fylder sig selv op igen ved næste Hent.

### 21. september 2026 — v298: XMLTV-synk fryser ikke længere appen

**Fejl indført i v297.** Da flere/store EPG-adresser kom ind, begyndte appen at
**fryse helt** ved start — også på hotspot uden panel, og også når boksen var
på kabel (så "sluk wifi" tog den ikke af nettet). Roden: en samlet
programoversigt (DK+UK ~30 MB tekst) blev pakket ud og **parset synkront på
hovedtråden** ved hver app-start. På en tv-boks er det sekunder hvor intet kan
klikkes. Og fejlede/afbrødes parsen, blev "sidst hentet" aldrig sat, så den
prøvede forfra **hver eneste gang** appen åbnede → permanent frys.

To rettelser (`syncXmltv.ts` + `syncAll.ts`):
- **Filen fodres til parseren i bidder** (256 KB) med et `setTimeout(0)`
  imellem, så UI'en når at tegne og reagere undervejs. Parseren beholder selv en
  hale mellem bidder, så elementer delt over to bidder ikke tabes.
- **"Sidst hentet" sættes FØR hentningen**, ikke efter. Dør/afbrydes appen midt
  i en tung parse, prøver den ikke forfra ved næste start — ét forsøg i døgnet,
  også når det gik galt.

En allerede-frossen boks helbredes ved at **sideloade v298-APK'en** (den frosne
app blokerer ikke installationen). Nødløsning uden ny APK: tag boksen **helt** af
nettet (kabel + wifi), åbn appen, ryd XMLTV-feltet under Redigér panel, sæt nettet
til igen — men gendan **ikke** fra skyen bagefter, for sikkerhedskopien indeholder
selv XMLTV-adressen.

### 17.–18. september 2026 — selv-opdatering, sky-backup, tv-rettelser

Nyeste udgave: **versionCode 297** (tv og telefon), udgivet i skyen. Udgaver
nummereres nu med `expo.android.versionCode` i `packages/app/app.json` — **hæv
det ved hver ny udgave**, ellers kan boksen ikke se at der er kommet en ny.

**v297 — XMLTV: gzip (.xml.gz) + flere adresser i samme felt.** Så man kan fylde
hullerne i guiden med gratis, offentlige EPG-feeds. `syncXmltv` (app):
- **Pakker .gz ud i appen** (`fflate`), så de fleste offentlige feeds (som
  udgives som `.xml.gz`) virker. Gzip genkendes på `.gz`-endelsen eller på filens
  magiske bytes; både pakket (≤25 MB) og upakket (≤40 MB) størrelse holdes under
  et loft, så en kæmpefil ikke sprænger hukommelsen. Kræver `arrayBuffer()` på
  fetch-svaret — tilføjet som valgfri på core's `FetchLikeResponse` og i
  `net/fetchImpl.ts`.
- **Flere adresser** i samme XMLTV-felt (adskilt med mellemrum/komma/linjeskift),
  så DK + UK kan lægges oveni hinanden. Fejler én adresse, springes den over og de
  øvrige kører videre; fejler ALLE, kastes fejlen (så en enkelt forkert adresse
  stadig giver besked). Matchning er uændret: `tvg-id` og ellers kanalnavn.
- UI: feltet hedder nu "XMLTV-adresse(r)" med en hint om flere/pakkede adresser.
- Tests: gzip-udpakning, flere adresser, og at én fejlende adresse ikke tager de
  andre. `scripts/maal/epgfeeds.mjs` gemt til at tjekke feeds (størrelse pakket +
  upakket).

**Verificerede feeds (målt med `maal`, sep. 2026):**
- **DK:** `https://epgshare01.online/epgshare01/epg_ripper_DK1.xml.gz` — 1,4 MB /
  9,9 MB upakket, 217 kanaler (DR1, DR2, TV 2 …). ✅
- **UK:** `https://epgshare01.online/epgshare01/epg_ripper_UK1.xml.gz` — 2,9 MB /
  21,9 MB, 486 kanaler. ✅ (alternativt `https://epg.pw/xmltv/epg_GB.xml.gz`, 755
  kanaler, 19,8 MB.)
- **US:** den fulde `https://epg.pw/xmltv/epg_US.xml.gz` er **203 MB upakket** —
  for stor til en tv-boks; appen springer den over (over loftet). Kun en lille
  delmængde (fx Pluto `https://i.mjh.nz/PlutoTV/us.xml.gz`, 7 MB) er realistisk
  on-device. Et fuldt US-EPG kræver en anden arkitektur (server-side filtrering).

**v296 — Redigér panel (fået en anden server).** Før kunne man kun tilføje og
fjerne en kilde; nu er der en **"Redigér"**-knap ved hvert panel i Indstillinger
→ Paneler og M3U-lister. Formularen er forudfyldt (adresse, brugernavn, navn,
XMLTV) med kodeordet hentet frem fra secure store, og man kan rette adressen
(eller login) og trykke **Gem**. Kilde-**id'et beholdes**, så favoritter, grupper
og egne logoer bliver hængende på panelet; kun det man rettede skiftes, og
kanalerne hentes forfra fra den nye server (`replaceChannels` under samme id).
Den nye server **prøves først** (`XtreamClient.authenticate`) — går login ikke
igennem, ændres INTET, så man ikke kan ødelægge et panel der virker ved at taste
forkert. `sources/connect.ts` → `editXtream`/`editM3u`; `storage/sources.ts` →
`updateSourceDetails`; UI i `features/sources/SourcesScreen.tsx` (AddSource blev
til `SourceForm`, der dækker både tilføj og redigér). Bemærk: skifter man til en
helt anden konto med andre stream-id'er, kan nogle gamle favoritter pege på
kanaler der ikke længere findes (uskadeligt — de vises bare ikke); samme
konto/mirror med ny adresse beholder favoritterne.

**v295 — hastigheds-regression rettet + nyhedskilder målt op.**

*Fuld skærm var blevet langsom.* v292 lagde en 300 ms panel-pause ind i `open()`
(HomeScreen) før afspilleren åbnede — tænkt til at give panelet tid til at
frigive sit ene slot, men den gjorde **hver** kanalåbning mærkbart langsommere.
Rullet tilbage: åbner nu straks efter preview er sluppet, som før v292. Bliver
den første stream alligevel afvist, fanger afspillerens 4-sekunders start-timer
(`INITIAL_STALL_TIMEOUT_MS`, v288) det. "Forbinder …"-laget (v292) blev også
tæmmet: det skjules så snart billedet er i gang (`hasVideo`), så det ikke blinker
igen ved en kort genbuffring.

*Nyhedsstriben viste "kun DR".* To grunde, begge målt op med `scripts/maal/
nyhedsfeeds.mjs` (motor `maal`, frit internet): (1) DR's nyheder bærer **ingen**
`<category>`, og jeg lagde `allenyheder` (foreningen af alle sektioner) først i
flettningen — så dublet-lugningen gav næsten alt det generiske mærke "DR" og
sultede sektions-mærkerne. (2) **TV2 tilbyder ikke længere et offentligt RSS**
(alle adresser gav 404). Rettet: henter nu DR's **sektioner direkte**
(indland/udland/sporten/penge/politik → mærkerne INDLAND/UDLAND/SPORT/PENGE/
POLITIK) + **Politiken** som en ægte anden avis. Frisk cache-nøgle
(`news_cache_v3`), så det slår igennem straks. `scripts/maal/nyhedsfeeds.mjs` er
gemt til fremtidige feed-tjek.

**v294 — nyhedsstriben: flere kilder + breaking.** Med DR bekræftet virkende
(v293) henter striben nu fra flere feeds: DR allenyheder + DR **indland/udland/
sporten** (giver mærkerne INDLAND/UDLAND/SPORT også når de enkelte nyheder ikke
selv er kategoriseret) + **TV2** (`nyheder.tv2.dk/rss`). `sync/news.ts` henter
alle parallelt, fletter dem skiftevis (round-robin, så striben veksler mellem
kilder), luger dubletter fra (samme historie i flere feeds) og skærer til 18.
Hver feed er valgfri: svarer én ikke (404/403/tom), springes den over, og
striben kører videre på dem der virker — så det aldrig bliver værre end DR alene.
**Breaking:** core (`parseNewsItems`) markerer en nyhed som breaking, hvis titlen
eller kategorien selv siger det (`/breaking|seneste nyt|sidste nyt|opdateres/i`);
striben viser den så med et rødt **BREAKING**-mærke. RSS lover ikke realtid — det
er et bedste-bud, ikke en push-alarm, og lyser kun når kilden selv signalerer det.
Bemærk: TV2's feed-URL kunne ikke verificeres fra udviklingsmiljøet (proxyen
blokerer den) — virker den ikke på boksen, falder striben bare tilbage til DR.

**v293 — nyhedsstriben viste kun vejr (rettet).** Nyhederne kom aldrig igennem:
DR's server (Akamai) svarer 403 — eller en samtykke-side helt uden `<item>` — på
et kald **uden** en browser-agtig User-Agent. Vejret kom, fordi ipwho.is og
open-meteo er ligeglade med User-Agent; DR er det ikke. `sync/news.ts` sender nu
`User-Agent` + `Accept` med til DR. Det krævede at hoveder faktisk når frem:
`withPanelCooldown` (cooldown.ts) og `withDnsFallback` (doh.ts) videresender nu
kalderens hoveder (og fletter dem under Host-hovedet i DNS-nødudgangen), og
`session.fetchImpl` er typet `HeaderFetch`. Cache-nøglen er `news_cache_v2`, så en
gammel tom-fortolket kopi ikke vises. Kan man se det virke? Indstillinger →
**Status → Nyheder** viser "for X min siden", når hentningen er kommet igennem
(og "aldrig", hvis DR stadig afviser).

**v292 — fem ting på én gang:**

1. **Fejl: "sendt i dag" manglede.** Bladrer man tilbage i guiden, sagde
   beskrivelsen "SENDT · i går" korrekt, men en udsendelse sendt tidligere I DAG
   stod bare "SENDT" uden dag. `dayContext` returnerer bevidst null for i dag (så
   det der sender *nu* ikke mærkes "i dag"); ny `relativeDay` giver altid en tekst
   ("i dag"/"i går"/…), og `NowNextBox` bruger den for sendt/senere (kun det live
   får ingen dag). `nowNext.ts` + test.
2. **Kanal kommer hurtigere frem (rod, ikke plaster).** `open()` frigav allerede
   previewet før afspilleren, men panelet slipper sit ene forbindelses-slot et
   øjeblik senere. `PreviewHandle.release` melder nu om previewet faktisk holdt en
   forbindelse; gjorde det, venter `open()` `PANEL_SETTLE_MS` (300 ms) før
   afspilleren åbnes — kun da, så en kold åbning ikke bliver langsommere. Sparer
   den afviste første stream, der før satte sig fast i "Forbinder …".
3. **Nyhedsstribe: kategori-mærker.** Core-parseren tager nu `<category>` med per
   nyhed (`parseNewsItems`), så striben kan mærke hver overskrift med fx INDLAND /
   SPORT i stedet for bare DR. Falder tilbage til "DR", når DR ikke angiver en
   kategori — ingen regression. `parseNewsHeadlines` bevaret som tynd wrapper.
4. **"▶ Nu"-chip i tv-guiden.** Har man bladret væk, er der nu ét tryk hjem til
   nutiden: en chip i grupperækken (den eneste række fjernbetjeningen når med pil
   op fra gitteret). Vises kun når der ER bladret.
5. **"Forbinder …"-lag på afspilleren.** Mens billedet buffres, stod skærmen sort
   ("kom langsomt"). Nu et roligt lag med logo, kanalnavn og spinner, til billedet
   er klart (`radioState`-skift). Kun på video; en fejl viser sin egen tekst.
6. **Status i Indstillinger.** Ny "Status"-sektion: hvornår kanaler, vejr og
   nyheder sidst blev hentet ("for 5 min siden"), så man kan se om noget er gået i
   stå uden at gætte. EPG hentes løbende per kanal og vises ikke.

**Guide: info-området kan nu vælges (ur/vejr, nyhedsstribe eller fra) (v291).**
Bruger ønskede et valg i Indstillinger i stedet for den gamle til/fra for
ur+vejr: enten (1) **Ur og vejr** som før, (2) en **Nyhedsstribe** i bunden af
guiden (tid fast til venstre; vejr + danske overskrifter ruller forbi som på en
nyhedskanal; forhåndsvisningen fylder fuld bredde), eller (3) **Fra**.
Indstillinger → "Guidens info-område" (kun tv), tre valg-chips. Gemt under den
samme nøgle `guide_clock_weather` som en `GuideInfoMode` (`clock`/`news`/`off`);
den gamle værdi `on` læses stadig som `clock`, så ingen mister deres valg.
Nyhederne kommer fra **DR's RSS** (`allenyheder`, gratis, ingen nøgle), renset i
`packages/core` (`parseNewsHeadlines`, testet) og hentet i `sync/news.ts`
(cachet i settings-kv, opdateret et par gange i timen, fejler stille — de gamle
overskrifter bliver stående). Vejret genbruges fra den eksisterende hentning.
Striben (`features/guide/NewsTicker.tsx`) er en `Animated`-marquee med to kopier
af indholdet, så den ruller uendeligt uden hul; den er kun i live mens
guide-fanen er fremme (afmonteres på faneskift, så animationen stopper).

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

**Logo-søgning: rammer bredere (v290).** Bruger (med billede af "Favoritter uden
logo"): "søgning efter logo — måske du bedre kan se det her, så vi rammer noget
mere." Kanalnavnene har feed-mærker og løsrevne landekoder (`US| FX WEST HD`,
`GOLD| BBC NORDIC DK RAW`), som gjorde søgningen forbi. `searchNameFor` i
`logoSearch.ts` fjerner nu også **ØST/VEST** (øst/vest-feeds deler logo) og
**løsrevne 2-bogstavs landekoder** (DK, US, UK, …) — men aldrig så navnet bliver
tomt. Så søger den fx `FX` i stedet for `FX West`, og `BBC Nordic` i stedet for
`BBC Nordic DK`. (Bemærk: det er den online logo-søgning, "Søg logoer", der
rammer bredere. Den automatiske registermatchning ved kanalhentning bruger
`normaliseChannelName` og er urørt her — kan udvides senere med et
`MATCH_KEY_VERSION`-løft, som koster en ny kanalhentning.)

**Guide: den lille "Kl."-klokke i hjørnet fjernet (v289, udgivet som 290).** Bruger: "fjern det
ur du lavede øverst til venstre i guiden." Nu hvor det store ur står ved
preview, var den lille header-klokke overflødig. `TimelineGrid`-hovedet viser nu
kun dagen, når man har bladret væk fra nu (window-day); `headerClock` fjernet.

**Afspiller: kanalen kommer selv frem uden at zappe (v288, udgivet som 289).** Bruger: "nogle
gange kommer kanalen ikke frem, så skal jeg lige trykke lidt frem og tilbage,
så kommer programmet." Årsag: når panelets ENE forbindelse ikke var nået at
blive fri (preview eller forrige kanal), leverede den nye stream ingenting og
stod bare i "Forbinder …" — og genforbindelsen ved et stille buffer-stall
udløste først efter **15 sekunder** (`STALL_TIMEOUT_MS`). Så nåede man selv at
zappe frem/tilbage (hvilket tvinger en frisk åbning) længe før. Nu skelnes der:
den FØRSTE forbindelse genforbinder efter **4 sek** (`INITIAL_STALL_TIMEOUT_MS`,
styret af `everReady`-ref pr. kilde), mens en genbuffring MIDT i afspilningen
stadig får de 15 sek, så et kort udfald ikke river billedet ned. Hårde fejl
retry'er stadig som før (to forsøg + format-fallback).

**Guide: grader inde i kassen + preview tættere på (v287, udgivet som 288).** Bruger (med billede):
"graderne går uden for kassen — de skal lidt til venstre — og preview skal fylde
lidt mere til venstre, så den går helt hen til ur/vejr-kassen." I `ClockWeather`
står dagens max/min nu på sin egen linje under nu-temperaturen (før løb "21° /
17°" ud over kantens højre side i den smalle søjle). Og mellemrummet mellem
ur/vejr-kassen og preview (`previewRow` gap) er sat fra `sm` → `xs`, så previewet
når næsten helt hen til kassen.

**Guide: ur/vejr gjort mindre (v286, udgivet med v285's preview-fix).** Bruger:
"kan ur og vejr laves lidt mindre, det er meget dominerende i forhold til
preview." `clockCol` fra 112 → 90 punkter, og skrifterne i `ClockWeather` ned
(ur 27 → 21, resten tilsvarende), så previewet får mere bredde og uret fylder
mindre. `tvRight` uændret (33 %), så det er previewet der vokser. Desuden: på
tv er bjælken under preview (kanalnavn + lydknap) fjernet — kanalnavnet står
allerede i nu/næste-boksen lige under, og lydknappen kunne alligevel ikke få
fokus på tv (`MiniPreview`: bjælken vises kun `!isTV`). Previewet er dermed
renere og en anelse mindre højt.

**Guide: preview bliver stort igen når ur/vejr slås fra (v285).** Bruger: "når
jeg slår uret fra, bliver previewet ved med at være lille — det skal jo blive
stort igen som før vi lavede ur og vejr." Fejl indført i v282-splittet: den
"uden ur"-gren tabte `!isTV`-betingelsen, så previewet på tv faldt ned i
telefonens `sideBySide`-gren og stod på 42 % (lille), selv med uret slået fra.
Rettet: på tv har previewet intet bredde-loft, så det fylder hele søjlen igen,
præcis som før ur/vejr blev tilføjet.

**Hastighed: fuld skærm, preview og Tilbage-til-menu (v284).** Bruger: "fuld
skærm tager lang tid om at komme; preview er langsom, når jeg skifter kanal
nedad; og Tilbage i guiden er langsom til at få menuen frem."
- **Fuld skærm hurtigere:** live-afspilleren fik et lille startbuffer
  (`minBufferForPlayback: 1`, `preferredForwardBufferDuration: 20`) i stedet for
  standardens ~2 sek — billedet kommer hurtigere. Arkiv/start-forfra beholder
  det store buffer (60/5) som film, så spoling er flydende. (Selve
  forbindelsen skal stadig vente på, at previewet slipper panelets ENE
  forbindelse — det er panelets grænse, ikke appens.)
- **Preview hurtigere:** `IDLE_MS` i `MiniPreview` fra 800 → 450 ms, så
  previewet kommer mærkbart hurtigere, når man står stille på en kanal; stadig
  nok til at en hurtig scroll ikke åbner en stream pr. række.
- **Tilbage-til-menu hurtigere:** `GuideScreen` er nu `memo`, og de callbacks
  HomeScreen giver den (`onPlay`/`onRestart`/`onBrowse`) er gjort referencestabile
  (`useCallback` + `placeRef`). Før tegnede HELE det tunge gitter om, hver gang
  HomeScreen tegnede — bl.a. når søjlen tog fokus ved Tilbage — så menuen kom
  langsomt. Nu springes gitteret over ved den slags gen-tegning.

**Guide + dagssiden: tre rettelser (v283).** Bruger: (1) "lav i Indstillinger så
man kan slukke [ur/vejr], og så er den bare som nu når man slukker"; (2) "i
beskrivelsen af udsendelsen, når man går tilbage i tiden, står klokken fint, men
jeg har brug for at vide hvad DAG man er gået tilbage på"; (3) "når jeg vælger
hele dagen, vises der kort i toppen et valg af hvad dag, men det forsvinder
hurtigt og man kan ikke vælge det."
- (1) **Kontakt i Indstillinger → Forhåndsvisning: "Ur og vejr i guiden"** (kun
  tv, `guide_clock_weather`, til som standard). Fra = guiden som før: preview i
  fuld bredde, `tvRight` tilbage til 28 %, intet vejr hentet. `GuideScreen`
  læser den ved åbning (fanen genmonteres, så et skift slår igennem næste gang).
- (2) **`NowNextBox` viser dagen ved klokkeslættet**, når udsendelsen ikke er i
  dag: kickeren bliver fx "SENDT · i går" / "· tor 17. sep". Ren `dayContext`
  i `nowNext.ts` (i dag → null, i går/i morgen, ellers ugedag + dato), testet.
- (3) **Dag-knapperne i "hele dagen" stjæler ikke længere fokus.** Live-rækken
  havde `hasTVPreferredFocus`, som greb fokus fra dag-knapperne, så de blinkede
  og ikke kunne vælges. Nu bliver fokus på den valgte dag-knap ved åbning (man
  går ned i listen, når man vil); listen ruller stadig til nu på i dag.

**Guide: stort ur + vejr til venstre for preview (v282, udgivet som 283, kun tv).** Bruger (med
billede): "kan man lave uret lige til venstre for preview og med vejret nedenunder."
Valgt **Variant A** (efter mockup): uret + vejret sidder i den tomme plads til
VENSTRE for preview, så intet skubbes nedad (lodret plads er knap på tv);
preview bliver bare en anelse smallere, og `tvRight` gik fra 28 % til 33 %.
Nyt: `ClockWeather.tsx` (stort ur, dato, vejr-ikon + nu-temp + dagens max/min +
dansk tekst). Vejret hentes af `sync/weather.ts`: **boksens position ud fra dens
IP** (`ipwho.is`, ingen tilladelse — tv-bokse har sjældent GPS) → **open-meteo**
(gratis, ingen nøgle) → temperatur + WMO-kode. Cachet i `settings` (`weather_cache`),
hentes højst én gang i timen, opdateres et par gange i timen mens guiden er åben.
Ren parsning + kode→tekst/ikon ligger i core (`weather/weather.ts`, testet).
Alt sluges stille: fejler position eller vejr, vises kun uret — aldrig en rå fejl.
(Den lille "Kl."-klokke i gitterets hoved bliver — den viser også dagen, når man
bladrer tilbage.)

**"Hele dagen": oprydningen slettede de dage guiden viste — rettet ved roden (v281).**
Bruger: "nej, de er ikke tomme i guiden — jeg kan fint starte noget for 3 dage
siden i guiden, men når jeg går under hele dagen ved en kanal, er der næsten
intet." Det var IKKE tomme fantomdage: dataene fandtes, men blev slettet igen.
**Rod:** `retentionCutoff` (EPG-oprydningen) beholdt kun `(archiveDays + 1)`
dage — og faldt til **12 timer**, når panelet ikke oplyste arkivdage
(`archive_days = 0`, selv med arkiv-flaget sat → `maxArchiveDays = 0`). Men både
guiden og dagssiden VISER 7 dage tilbage. Guiden viste 3 dage fra sin
in-memory-indlæsning lige efter en hentning; så ryddede `deleteProgrammesBefore`
databasen ned til 12 timer, og dagssiden — der læste databasen bagefter — stod
næsten tom. **Fix:** oprydningen beholder nu mindst hele visningsvinduet
(`DISPLAY_RETENTION_DAYS = 7`) uanset arkivet (mere hvis arkivet er længere).
Selve start-forfra er stadig kun muligt inden for arkivet. Desuden læser
dagssiden nu HELE spanet i ét opslag (som guiden) og skærer hver dag ud lokalt,
så de to skærme garanteret er enige om, hvad der er data til; antal bagud-dage
følger den ældste udsendelse i spanet. (Efter opdatering kan det kræve, at
appen henter tabellen én gang, før de ekstra dage dukker op.)

**"Hele dagen": dag-knapper kun så langt tilbage som der er data (v280, afløst af v281).** Bruger:
"når jeg kigger EPG for hele dagen, kan jeg stadig kun køre tilbage til kl 23:55
i går, men bladrer jeg i guiden, kommer jeg fint meget længere tilbage." I v278
satte jeg dagssidens bagud-knapper til et fast antal (7), men panelet gemmer kun
programlisten et stykke tilbage, så de ekstra knapper stod tomme ("ingen tabel")
— det lignede, at man ikke kunne komme længere. Dagssiden og guiden læser den
SAMME cache (`listProgrammes`), så der er ikke mere data at hente bagud i den ene
end i den anden; guiden føles bare dybere, fordi man kan bladre tomme celler
igennem. Nu regnes antallet af bagud-dage ud fra den ÆLDSTE cachede udsendelse
for kanalen (`earliestProgrammeStart` = `MIN(start_ms)`), klemt til [1,
MAX_DAYS_BACK] og opdateret når den fulde tabel er hentet. Så viser dagssiden
præcis de dage, der faktisk har indhold — lige så langt tilbage som guiden reelt
rækker, uden tomme fantomdage. (Vil man have flere dage bagud, er det panelets
programliste, der skal nå længere — ikke appen.)

**Guide: beskrivelsesboksen følger med tilbage i tiden (v279).** Bruger: "når
jeg går tilbage i tiden på guiden, har jeg svært ved at se, hvilken udsendelse
man er kommet til — beskrivelsesvinduet til højre er låst på live nu, men det
skal skifte, når jeg bladrer tilbage, som vi har haft før." Boksen til højre
(`NowNextBox`) beskrives af `focusedProgramme`, som blev sat af den GAMLE
gitter-rækkes `onCellFocus` — den nye `TimelineGrid` meldte kun den fokuserede
KANAL, aldrig hvilken udsendelse. Nu har `TimelineGrid` et `onFocusProgramme`,
der melder den fokuserede kanals "primary" i det aktuelle vindue (live når nu er
i vinduet, ellers første udsendelse i vinduet) — og den genberegnes, når
`offsetMinutes` ændres. `GuideScreen` sender den videre til `setFocusedProgramme`,
så boksen viser titel, tid og beskrivelse for netop den udsendelse man er
bladret hen til, med etiket NU/SENERE/SENDT.

**Guide: klik på en kanal står nu på "Se kanalen" (v278, udgivet som 279).** Bruger (med
billede): "når jeg trykker på en kanal i guiden, vil jeg gerne have, at den
som standard står på Se DR1 og ikke på Start forfra." I `ProgrammeSheet` stod
fjernbetjeningen før på **Start forfra**, når den var mulig. Nu har **"Se
{kanal}"** altid `hasTVPreferredFocus` og accent-farven, og Start forfra ligger
lige under (kun et tryk ned væk). Skifter kun tilbage til Start forfra som
standard, hvis der undtagelsesvis slet ikke er en Se-knap (`!options.play`).

**"Hele dagen": så langt tilbage som guiden (v278, udgivet som 279).** Bruger: "jeg kan se,
at det kun er, når jeg vælger hele dagens EPG, jeg ikke kan gå langt nok
tilbage i tiden — i guiden virker tilbage fint." `ChannelDayScreen` begrænsede
antallet af bagud-dage til `channel.archiveDays` (`daysBack = Math.min(MAX_DAYS_BACK,
archiveDays)`), mens guiden viser al cachet EPG uanset arkiv. Nu er `daysBack =
MAX_DAYS_BACK` (7 dage), så dagssiden tilbyder de samme dage tilbage som guiden;
en dag uden tabel viser bare "ingen tabel", og Start-forfra er stadig kun muligt,
hvor arkivet rækker (styret pr. udsendelse af `restartable`). Hint-teksten
udløses nu på `channel.archiveDays === 0` (ikke `daysBack === 0`, som aldrig
længere er sandt) og siger, at oversigten kan ses, men at tidligere udsendelser
ikke kan startes forfra uden arkiv. (Hvor langt TILBAGE selve programlisten
findes er stadig en panel-grænse — de fleste paneler gemmer kun ~1 døgn bagud.)

**"Hele dagen": let første tegning, så markøren kommer hurtigt (v277, udgivet som 279).** Bruger:
"når jeg vil se hele dagens EPG på en kanal, tager det meget lang tid, før
vælger kommer, så man kan køre op og ned." `ChannelDayScreen` havde
`initialNumToRender={Math.max(20, liveIndex + 10)}` — den tegnede ALLE rækker op
til den live-udsendelse (tit 40+) på én gang, hvilket er en tung første tegning
på tv-boksen. Nu: `initialNumToRender={12}`, `maxToRenderPerBatch={12}`,
`windowSize={9}` — kun en håndfuld rækker tegnes først, så markøren kommer
hurtigt; `scrollToIndex` + `onScrollToIndexFailed` ruller ned til nu bagefter.
(Bemærk: hvor langt TILBAGE oversigten rækker er en panel-grænse — de fleste
paneler gemmer kun programlisten ~1 døgn bagud; selve arkivet/afspilningen kan
gå længere.)

**Afspiller: fjern de to zap-pile (‹ ›) fra bjælken (v276, udgivet som 277).** Bruger (med
billede): "denne menu her i bunden kan du godt fjerne de 2 pile." Nu hvor
venstre/højre på fjernbetjeningen zapper (v275), var ‹ ›-knapperne overflødige.
Fjernet fra `actions` i `PlayerScreen.tsx`; "⇄ forrige kanal"-knappen og Tekst
står stadig. `zapList`/`zapIndex` bruges videre af fjernbetjenings-zap og radio.

**Afspiller: zap kanal med pil venstre/højre i fuld skærm (v275).** Bruger: "kan
vi lave at når jeg er inde på en kanal i fuld billede, at pil højre = næste
kanal og venstre = forrige." Zap-infrastrukturen var der allerede (`zapList` =
listen kanalen kom fra, `zapTo`, prev/næste-knapper). På en LIVE-kanal gjorde
pil venstre/højre ingenting når bjælken var skjult (`onPlayerKey` returnerede
false). Nu: live + bjælke skjult → venstre/højre zapper til forrige/næste kanal
i listen (rundt). I arkivet (start forfra) spoler de stadig — der er noget at
spole i. `PlayerScreen.tsx onPlayerKey`.

**Guide: husk programkortet, så der ikke står "Ingen oversigt" hver gang
(v274, udgivet som 275).** Bruger: "hver gang jeg går på guiden starter den med ingen oversigt,
som om den skal downloade det hver gang." Guide-fanen renderes som `{tab ===
'guide' && <GuideScreen/>}` i HomeScreen — den AFMONTERES når man forlader fanen
(modsat VOD/radio, der bliver hængende skjult). Så `progMap` var tom ved hver
genåbning, til cachen var læst ind igen. `TimelineGrid` gemmer nu det sidst
indlæste `progMap` på modulniveau (`lastProgMap`) og starter `useState` fra det,
så det huskede vises straks; `draw()` opdaterer det med en frisk cache-læsning.
(At holde guiden monteret ville risikere at previewet holdt panelets ene
forbindelse — derfor modul-cachen i stedet.)

**Film: mere buffer, så afspilningen kører flydende (v273, udgivet som 274).** Bruger: "ved ikke
om den skal downloade noget buffer når man ser film — som om det ikke kører helt
flydende; har 400 Mbit, så det er ikke derfor." Ikke båndbredden, men hvor meget
der ligger klar. `VodPlayerScreen` brugte expo-videos standard-buffer (kun 20
sek frem, genoptager efter 2 sek). På et panel der sender i stød løb bufferen
tom og hakkede. Nu sættes `player.bufferOptions`:
`preferredForwardBufferDuration: 60` (60 sek frem), `minBufferForPlayback: 5`
(vent til 5 sek er hentet før der spilles videre efter en pause/buffering, så
den ikke starter på en tynd buffer og straks står igen),
`prioritizeTimeOverSizeThreshold: true` (hold de 60 sek selv på høj bitrate).
Kun film (VOD); live-afspilleren er urørt.

**Guide iteration 14: ur øverst i guiden (v272, udgivet som 273).** Bruger: "kan man lave noget
med et ur et smart sted på guiden, så man hurtigt kan se klokken?" Hoved-cellen
øverst til venstre (over kanalkolonnen) viser nu den rigtige tid ("Kl. 20:14",
`clock(now)`, opdateres hvert minut via `now`-prop'en), altid synlig. Har man
bladret væk fra nu, står den dag vinduet viser lige under (accent, lille).
`HEADER_HEIGHT` 26 → 32 for at få plads til to linjer. Erstatter den gamle
"● NU / I dag"-tekst samme sted.

**Guide iteration 13: Tilbage går direkte til menuen (v271, udgivet som 272).** Bruger: "den må
gerne være hurtigere til at komme til menu — når jeg trykker tilbage i guiden
tager det et par sekunder, så man er i tvivl om man har trykket." Årsag: på
guide-fanen stillede første Tilbage FØRST vinduet på "nu" (`offsetMinutes = 0`)
og krævede et tryk til for at nå menuen — så første tryk så ud til ikke at gøre
noget. Nu går Tilbage direkte til menuen (guide-backRef håndterer kun dagssiden),
og vinduet stilles i stedet på "nu", når man kommer ind i guiden fra menuen igen
(`setOffsetMinutes(0)` på `focusFirstSignal`-skift). (Bygget oven på it.12; 270
blev aldrig udgivet — foldet ind her.)

**Guide iteration 12: hent flere dage frem i EPG'en (v270, udgivet som 271).** Bruger: "jeg kan
kun køre 8-9 timer frem/tilbage, den stopper helt som om der ikke er mere." 8-9
timer = præcis de 12 udsendelser `get_short_epg` giver ("nu + næste"). Guiden bad
kun om 12 (`DEFAULT_LIMIT`), så når den fulde tabel (`get_simple_data_table`)
ikke rakte længere for panelet, stod resten tomt. Nu beder guiden om
`GUIDE_EPG_LIMIT = 200` kommende udsendelser via `ensureEpg(..., limit)`, så den
henter flere dage frem, så langt panelet har oversigt. `get_short_epg` giver kun
fremad; fortiden kommer stadig fra den fulde tabel — panelet leverer sjældent
meget bagud. (Bygget oven på it.11; 269 blev aldrig udgivet — foldet ind her.)

**Guide iteration 11: tid frem/tilbage virker igen (v269, udgivet som 270).** it.9 (v267) fik
venstre/højre til at reagere på tast-NED (`eventKeyAction` 0) for at være
hurtigere — men brugerens boks sender KUN tast-SLIP (action 1) for pil
venstre/højre, så guarden `=== 1 return` sprang det eneste signal over, og man
kunne slet ikke skifte tid ("kan ikke køre tilbage og frem i tiden"). Rullet
tilbage til at reagere på tast-slip (`=== 0 return`), præcis som det virkede i
265/266. Alt andet fra it.10 (hele arkiv-spændet) beholdt.

**Guide iteration 10: hele arkivet tilbage igen (v268).** Bruger: "jeg kan kun
gå 8-9 timer tilbage, plejer at kunne se flere dage tilbage." Den nye guide
henter programdata ÉN gang for et fast vindue (for fart) — og det var kun sat
til 6 timer tilbage, så man ramte en mur efter en aften. Nu dækker det hentede
vindue hele det spænd man kan bladre i: `SPAN_BACK_MIN = −DRAG_MIN_MINUTES` og
`SPAN_FWD_MIN = DRAG_MAX_MINUTES` (7 dage hver vej, samme grænser som trækket),
så man når lige så langt tilbage som arkivet, som før. (Bygget oven på it.9;
267 blev aldrig udgivet — foldet ind her.)

**Guide iteration 9: hurtigere venstre/højre i tid (v267, udgivet som 268).** Bruger: "har du
venstre og højre også lidt hurtigere?" Tidsskiftet reagerede før på tast-SLIP
(`eventKeyAction` 1), hvilket føltes forsinket og ikke gentog ved at holde
tasten. Nu reageres på tast-NED (0): svarer med det samme, og holder man tasten
inde, sender Android gentagne ned-tryk, så man hurtigt kan bladre gennem tiden.
(Bygget oven på it.8; 266 blev aldrig udgivet — foldet ind her.)

**Guide iteration 8: NU-streg flugter + hurtigere op/ned (v266, udgivet som 267).** Bruger:
"næsten perfekt — den røde streg bliver lidt forskudt på den kanal jeg går ind
på, og sæt klik-farten en anelse op." NU-linjen sad forkert på den fokuserede
række, fordi rækken skalerede op (1,05) på fokus: hele rækken — og NU-stregen i
den — voksede, så den ikke flugtede med de andre rækkers. Nu bruger guide-rækken
`TvPressable`s `flat` (fokus vises med ramme/ring, uden opskalering), så
kolonner og NU-streg flugter på tværs af alle rækker. Og op/ned er sat en tak op
i fart: `scrollToIndex({animated:false})` i stedet for den animerede centrering,
så listen følger fokus uden en blød rulning per tryk.

**Guide iteration 7: live vist med blå forløbs-streg (v265).** Bruger efter
it.6 ("nu tror jeg vi er ved at være der"): den live-udsendelse skal ikke være
rammet ind, men have en tynd blå streg under — og efter et mockup (variant B):
stregen skal vise **hvor langt** udsendelsen er nået, som Tablos. I
`TimelineGrid.tsx`: live-cellen har ikke længere accent-ramme; i stedet en tynd
blå streg i bunden — en svag blå bane (`colors.accent` 22 %) med en massiv blå
fyld ovenpå, bredde = forløbet `(nu − start) / (varighed)`. Den udsendelse OK
åbner når man bladrer frem uden noget live i vinduet, får en enkel blå streg
(`okUnderline`). Rød NU-linje i vinduet beholdt. Ellers uændret fra it.6.

**Guide iteration 6: Tablo-udseende oven på den lodrette liste — 30-min
kolonner (v264).** it.5's lodrette liste virkede endelig (bruger: "det virker
det hele nu faktisk" — op/ned + OK åbner programmet), men: den grå live-bjælke
fyldte for meget, det var svært at se hvor i tiden man var når man kørte tilbage,
og det kørte "lidt i slowmotion". Bruger ville også have Tablos look "delt op i
kolonner af 30 minutter". Så `TimelineGrid.tsx` beholder **den lodrette liste og
hele-række-fokus** (den navigation der virker) og lægger Tablo-UDSEENDET ovenpå:
- **Tv-guide-gitter:** kanaler som rækker, tiden i **3 kolonner à 30 min**.
  Udsendelserne fylder deres rigtige tid i vinduet (`layoutRow`), med et
  **tidshoved** (18:00 · 18:30 · 19:00) så man altid kan se hvor i tiden man er —
  det løser "svært at finde ud af når jeg kører tilbage".
- **Navigationen urørt:** hele rækken er ét trykpunkt, op/ned er almindelig
  listenavigation, OK åbner den relevante udsendelse (live hvis nu er i vinduet,
  ellers den første i vinduet — markeret med accent-kant).
- **Pil venstre/højre = ±30 min** (én kolonne) som tastetryk (`useTVEventHandler`,
  ikke fokusflytning), hele gitteret glider med. Forskydningen deles med
  telefonen (`offsetMinutes` fra GuideScreen), så hardware-Tilbage stiller
  vinduet på nu.
- **Ingen slowmotion:** programdata hentes ÉN gang (`listProgrammes` for spanet),
  og vinduet forskydes kun lokalt (ren `layoutRow`-regning) — ingen ny hentning
  per tryk. Cachen tegnes straks; `ensureEpg`/`ensureFullEpg` fylder på bagefter.
- **Den grå bjælke væk:** live er nu en slank rød venstrekant på cellen + en rød
  NU-linje i vinduet, ikke en stor grå flade.

**Guide iteration 5: HELT som favoritterne — lodret liste, tekst + tid, rød
linje (v263, look udvidet i it.6).** it.4 (boksene) fejlede paa boksen: ingen blok viste "● NU"
(live-data var ikke hentet), EPG'en kom "først efter et halvt minut", boksene
"så tossede ud", og ned-tasten "fisede op til grupperne". Bruger: "hvad med at
lave det helt uden bokse så det bare er tekst og tid som står og stadig den røde
linje?" Det var det rigtige. `TimelineGrid.tsx` er nu en **lodret liste som
favoritlisten** (`ChannelList`), som brugeren gentagne gange siger virker super
godt op/ned:
- **Én række per kanal, ingen kasser, intet vandret gitter.** Bare logo + navn,
  og hvad kanalen sender på markørtidspunktet: klokkeslæt + titel som ren tekst.
  Op/ned er derfor almindelig listenavigation — det fjerner "ned fiser op til
  grupperne" helt (det kom af det vandrette fokus-gitter).
- **Den røde linje = live-rækkens venstrekant.** Den kanal der sender NU har en
  rød venstrekant + "● NU" (transparent kant på alle andre, så rækken ikke
  hopper i bredden når den bliver live).
- **Tid vælges med pil venstre/højre** — håndteret som *tastetryk*
  (`useTVEventHandler`), IKKE en fokusflytning: rækkerne er ét trykpunkt hver,
  intet fokuserbart til siderne, `TVFocusGuideView trapFocusLeft/Right`. Så et
  venstre/højre-tryk skruer bare på tidsmarkøren (±30 min), hele listen viser
  hvad kanalerne sender på det nye tidspunkt, og man ryger aldrig "ud i menuen".
  Op fra øverste række når stadig gruppe-chipsene.
- **Hurtig som favoritterne:** kun NU/næste fra den lokale cache først (ét
  indekseret `getNowNext` per kanal), panelet (`ensureEpg`) bagefter. Det gamle
  gitter hentede HELE programtabellen for ALLE kanaler (`ensureFullEpg`) før det
  kunne tegne — derfor "et halvt minut".
- Listen følger fokus (`keepInMiddle`), fokuseret række vokser som
  favoritrækkerne (`TvPressable`). OK åbner programbladet (se/​start forfra/hele
  dagen). Telefon urørt (vindue-modellen på `!isTV`, sikkerhedsnet).

**Guide-tidslinje iteration 4: ens blokke som favoritterne (v262, afløst af it.5).** Bruger:
"måske vi skal lave lidt som i favoritter, hvor blokke med live er ens nedad og
blokke til højre/venstre har samme størrelse og bliver større når jeg klikker på
den — favoritter virker super godt også med at køre op og ned." Så
`TimelineGrid.tsx` er skiftet fra **tidsproportionale celler** (bredde =
varighed) til **ens-brede, indeks-baserede blokke** — den model der gør op/ned
robust:
- **Ens blokke, live forankret nedad.** Hver blok er lige bred (`BLOCK_W`),
  uanset udsendelsens længde. Den der sender NU står i samme lodrette kolonne i
  ALLE rækker (forankret ved `ANCHOR_X`). Derfor lander man ved op/ned fra en
  live-blok på nabokanalens live-blok — blokken lige nedenunder ligger på
  nøjagtig samme sted. Det kunne det tidsproportionale gitter ikke: der havde
  hver celle sin egen bredde/placering, så "cellen nedenunder" tit var naboen.
  Ingen `TVFocusGuideView destinations`-omdirigering mere — den kæmpede mod
  Androids fokus; nu flugter kolonnerne bare geometrisk.
- **Glider bloedt i tid.** Alle rækker deler én `scrollX` (kolonne × `SLOT`).
  Går man til siden, glider HELE fladen med (`Animated`, native), og
  live-kolonnen bliver ved med at flugte. Lander op/ned på samme kolonne, glider
  den slet ikke (`colRef`-vagt), så det står helt stille lodret.
- **Fokuseret blok vokser** som favoritrækkerne (`TvPressable`s normale
  fokus-skalering 1,05 — ikke `flat`), og live-blokken har accent-kant + "● NU".
- Beholdt fra it.3: listen følger fokus lodret (`scrollToIndex viewPosition:0.5`
  + `paddingBottom`), tom kanal springes ikke over (fokuserbart felt), og
  `trapFocusLeft/Right` så tid-til-siden ikke slipper ud i menuen. Telefon urørt
  (drag-modellen står stadig på `!isTV`, sikkerhedsnettet fra v257).

**Guide-tidslinje iteration 3: op/ned rammer live, listen følger fokus (v261, afløst af it.4).**
(v260 blev aldrig udgivet — foldet ind her.) To ting oven på it.2 (+ it.2's
overlap-klip og fokus-uden-skalering, se nedenfor):
- **Op/ned rammer live-cellen.** Bruger: "op/ned skal ramme den der er live ved
  den røde linje; tit lander jeg ved siden af, men preview/beskrivelse viser den
  rigtige." Fokus landede på rette RÆKKE men forkert CELLE (geometrisk nabo).
  Nu er hver rækkes celler pakket i en `TVFocusGuideView` hvis `destinations`
  peger på live-cellen (`TvPressable` `forwardRef` → `setLiveNode`). Kommer
  fokus ind i rækken op/ned, sender Android det til live-cellen. Native, kæmper
  ikke mod fokus (samme mekanik som v255).
- **Listen følger fokus lodret.** Bruger: "kan ikke se hvad der sker i bunden;
  der er flere kanaler." FlatList rullede ikke ned til den fokuserede række, så
  den blev skåret af. Nu `scrollToIndex({viewPosition:0.5})` ved kanal-fokus +
  `paddingBottom` under sidste række, så den fokuserede kanal altid centreres og
  man kan se rækkerne under.
- Også foldet ind fra it.2: overlap/dublet-klip (samme udsendelse 2×) og
  `TvPressable` `flat` (fokus uden opskalering, så cellen ikke vokser ud over
  naboen).

**Guide-tidslinje iteration 2: mindre celler, ingen tomme spring (v260, ej udgivet).**
Bruger efter v258: "man kommer hen til den live kanal nu, men springer lidt
rundt; cellerne er meget store med mange sorte rammer; gør som Google hvor de er
mindre og ens; en kanal helt uden EPG springes over." Ændringer i
`TimelineGrid.tsx`:
- **Mindre celler:** `PX_PER_MIN` 5 → 2,8 (1 time = 168 px), `ROW_HEIGHT` 64 →
  52, mindre skrift/padding. Meget mere tid synligt, cellerne føles ikke kæmpe.
- **Færre "sorte rammer":** en svag baggrund (`stripFill`) ligger bag cellerne
  hele vejen, så huller mellem udsendelser ikke står som sorte felter.
- **Kanal uden EPG springes ikke over:** før havde en tom række ingen
  fokuserbar celle → op/ned sprang forbi den. Nu ligger et fokuserbart felt
  UDEN for den glidende flade og fylder det synlige (`emptyCell`), så man altid
  kan lande på kanalen og starte den (ny `onChannelFocus`-callback, der ikke
  glider tidslinjen).
- **Live skiller sig ud:** nu-cellen har en accent-kant.
**Stadig åbne (iteration 3):** den fokuserede celle skal "blive større/bredere"
som Googles (Xumo-pillerne), det lille "springer lidt rundt" ved lodret skift,
og evt. helt ens-brede piller frem for tidsproportionale. Bruger: "tror vi er
tæt på."

**Afspiller på tv: bjælken gemmer sig igen — uden at miste knapperne (v259).**
Bruger efter v256: "nu er knapper fremme hele tiden i bunden." v256 gjorde
bjælken permanent for at kunne nås; nu dækker den billedet konstant. v259:
bjælken auto-gemmer sig igen (også på tv), MEN når den er skjult, holder en
usynlig fuldskærms-flade (`<View focusable hasTVPreferredFocus>`) fokus INDE i
afspilleren. Det var netop det der manglede i den oprindelige version: når den
fokuserede knap forsvandt, flyttede Android fokus UD af afspilleren (til menuen
bagved), og så kunne man ikke hente knapperne frem — deraf "kan slet ikke komme
hen til dem". Med fokus-fladen bliver fokus i afspilleren; et tryk henter
bjælken, og mens den er fremme kan alle knapper nås (som i v256). `onPlayerKey`
(OK = pause, pil = spol) virker igen mens bjælken er skjult, fordi ingen knap
har fokus da. `Landscape.tsx`.

**Guide på tv bygget om til en glidende tidslinje (v258, ITERATION 1).** Bruger
valgte den fulde ombygning (som Google/Xumo): "når jeg skifter i timer springer
det hele voldsomt; Googles kører i en glidende bevægelse." Ny komponent
`features/guide/TimelineGrid.tsx` erstatter det gamle vindue-gitter PÅ TV
(telefon urørt — dér er drag-modellen fin til fingre). Model:
- Cellerne sidder på deres **rigtige klokkeslæt**: bredde = varighed i minutter
  × faste pixels (`PX_PER_MIN`). Så cellen lige nedenunder er samme tid →
  op/ned rammer rent (løser også det gamle lodrette spring).
- **Én delt `scrollX`** (Animated, native driver) for alle rækker. Når en celle
  får fokus, glider hele fladen blødt (`Animated.timing` 240 ms), så cellen
  står ved et fast punkt (`ANCHOR`) til venstre. Ingen faste 60-min-spring —
  det er den "glidende bevægelse" brugeren efterspurgte.
- Rød **nu-linje** ligger på tid og glider med. Tidshoved med timer glider med.
- Programdata for **hele spanet** (`SPAN_BACK`/`SPAN_FWD`) lægges i `progMap`
  (lokal DB via `listProgrammes` + `ensureFullEpg` i baggrunden) — intet
  forsvinder når man glider frem/tilbage.
- Fokus: cellerne er fokuserbare `TvPressable`; første rækkes live-celle får en
  ÉT-SKUDS `hasTVPreferredFocus`-puls (ikke statisk — det river ellers fokus
  tilbage). Kanalkolonnen til venstre står fast; kun tidslinjen glider.
Wiret i `GuideScreen` bag `{isTV && <TimelineGrid …/>}`; det gamle vindue-gitter
+ dagsknapper kører kun på `!isTV`. Preview-søjlen, programbladet og gruppe-chips
er genbrugt uændret. **EKSPERIMENTELT — iteration 1, skal afprøves på boks.**
Sikkerhedsnet: 257 (`git`), og det gamle gitter ligger stadig i filen bag
`!isTV`. Kendte åbne punkter til næste iteration: den fokuserede celle "bliver
lang" som Googles (ikke gjort), huller mellem udsendelser, og finjustering af
`PX_PER_MIN`/`ANCHOR`/`SPAN`.

**Guide: programdata forsvandt når man gik frem/tilbage i tiden (v257).**
Bruger: "når jeg klikker tilbage i tiden og frem igen er alt også væk." Årsag i
`GuideScreen.tsx` `drawFromCache`: den sprang kanaler over der "allerede var
tegnet" for et vindue (`drawnFor`-map), men `rows` holder kun ÉT vindues
programmer ad gangen og bliver overskrevet når man ruller til et andet
tidspunkt. Kom man tilbage til nu-vinduet, troede den det var tegnet og
genindlæste ikke — cellerne stod tomme. Fix: `drawnFor`-optimeringen fjernet;
de synlige kanaler genindlæses altid fra den lokale database for det aktuelle
vindue (`listProgrammes` er en hurtig indekseret opslag). **Bemærk:** dette er
en lappe på det gamle vindue-model; den rigtige kur er tidslinje-ombygningen
nedenfor (bruger valgte den) — data ligger så for hele spanet, ikke pr. vindue.

**Afspiller på tv: knapbjælken bliver stående og ligger i bunden (v256).**
Bruger: "jeg kan slet ikke komme hen til [de andre knapper]." Årsag:
`Landscape.tsx` gemte bjælken efter 5 sek. og genskabte den ved næste tryk —
og fordi "Start forfra" har statisk `hasTVPreferredFocus`, faldt fokus tilbage
dertil hver gang bjælken kom igen, så man aldrig nåede Tekst/‹/›. Fix: på tv
gemmer bjælken sig **ikke** (auto-hide sprunget over på tv), så knapperne bliver
stående og kan nås frit; på telefon (fingre) gemmer den sig stadig. Desuden lå
knapperne et stykke oppe fra bunden, fordi `paddingBottom` lagde skærmens sikre
bund-kant til — på tv er der ingen navigationslinje at holde fri af, så
bund/side-insets droppes på tv (`isTV ? 0 : insets.*`), og bjælken ligger nu i
bunden. **Bivirkning:** når bjælken altid står på tv, kaldes `onPlayerKey` ikke
længere for OK/venstre/højre (de rammer knapperne i stedet); pause/spol sker via
medietasterne og `SeekButtons` (vises under start-forfra). Ses det som for
påtrængende at bjælken altid står, er næste skridt en skjul-igen der IKKE
genskaber bjælken (fx behold monteret, skift synlighed) så fokus ikke nulstilles.

**Guide: ned/op rammer live-cellen — native forsøg (v255, EKSPERIMENTELT).**
Efter v253's tilbagerulning (nedenfor) et NYT forsøg med den rigtige mekanik,
denne gang uden JS-fokus-kamp: Androids egen `TVFocusGuideView destinations`
(UIFocusGuide). Hver kanal-rækkes celler er nu pakket i en `TVFocusGuideView`,
hvis `destinations` peger på rækkens **live-celle** (den hvis `state === 'live'`).
Kommer fokus ind i rækken oppefra/nedefra, omdirigerer Android selv til
live-cellen — så ned/op rammer det der sender nu, uanset at cellerne er
proportionale med varigheden (forskellig bredde). Ref-plumbing: `TvPressable`
er nu `forwardRef` (videregiver ref til den indre `Pressable`); live-cellen får
en tilbagevendende ref via `setLiveNode`, og `GuideRow` sætter
`destinations={[liveNode]}`. Baggrund (bruger viste Google/Xumos guide): dér er
cellerne ENS brede piller med luft imellem, så kolonnerne flugter og op/ned
rammer geometrisk rent; vores er en tidslinje, så vi bruger UIFocusGuide til at
opnå det samme funktionelt. Desuden: **`‹` foran den klippede venstre-celle**
(som Googles guide) — begyndte en udsendelse før vinduets venstre kant
(`cells[0].clippedStart`), vises et `‹` foran titlen, så man kan se der er
mere/tidligere den vej. **Skal afprøves på boks** — virker det ikke rent,
rul tilbage til 254 (`git checkout e6a8aa0 -- GuideScreen.tsx` + behold
TvPressable-forwardRef, den er harmløs). **Åbent, større skridt:** Googles
*udseende* (ens-brede piller, den fokuserede bliver lang) er en egentlig
layout-ombygning af `layoutRow`/`GuideRow` — ikke gjort endnu.

**v253 rullet tilbage (v254).** v253's "bevar tidspunktet ved lodret
kanalskift" gjorde det VÆRRE: brugeren meldte "det er blevet værre med at holde
den røde linje, og jeg kan ikke få lov at køre over på mange af dem der kører
live nu — så springer den vildt rundt." Årsag: omdirigeringen i `onCellFocus`
(setFocusTarget ved hvert lodret skift der ikke ramte markør-tiden) kæmpede mod
Androids egen fokus-flytning og skabte en løkke der sprang rundt og spærrede
for at lande på live-cellen. `GuideScreen.tsx` er rullet tilbage til v252-
tilstanden (`git checkout deb0b74 -- GuideScreen.tsx`) — v250 (alle rækker på
tv) og v251 (celle-nøgle på pladsen + Favoritter under Guide) er bevaret. Den
oprindelige gene (ved den røde linje rammer ned/op tit nabocellen) er tilbage,
men det er en LILLE gene mod en app der springer vildt rundt. **Lære:** denne
form for fokus-styring skal afprøves på en rigtig boks før udgivelse; en
`setFocusTarget` der fyrer på hvert fokus-skift kapløber med Androids TV-fokus.
Et fremtidigt forsøg bør i stedet lade Androids `nextFocusDown`/`nextFocusUp`
pege eksplicit, ELLER kun gribe ind på et bevidst tastetryk (ikke i onFocus),
og testes på boksen.

**Lodret kanalskift i guiden bevarer tidspunktet (v253 — rullet tilbage, se ovenfor).** Bruger: "når jeg
kører ned ad i guiden og står ved den røde live-linje, springer den tit ved
siden af, og man skal flytte den hen på det der sender nu." Årsag: ned/op i
gitteret lod Android vælge cellen i den næste række rent geometrisk — og fordi
udsendelser har forskellig bredde, ramte den tit nabocellen i stedet for den
udsendelse der dækker samme klokkeslæt. Løsning i `GuideScreen.tsx`: en
**markør-tid** (`cursorTimeRef`) — den "søjle" man bladrer i. Den sættes når man
går til venstre/højre (står man ved den røde linje, er den "nu"; ellers midt i
den udsendelse man står på). Ved lodret kanalskift (ny række) bevares den:
lander Android på en celle der ikke dækker markør-tiden, flyttes fokus i
`onCellFocus` til den udsendelse i den nye række der gør (`focusKey` →
`hasTVPreferredFocus`, samme mekanik som venstre/højre-vindueskift). Så ned/op
ved den røde linje rammer nu næste kanals nu-udsendelse; er man kørt tilbage i
tiden, følger den samme klokkeslæt. Reageres der **efter** fokus er landet (i
onCellFocus), er der ingen tast-timing at kapløbe med. Markøren nulstilles til
nu når man går ind i guiden.

**Video-kanal med "radio" i navnet stod sort i fuld skærm (v252).** Bruger:
"en enkelt kanal virker i preview, men i fuld skærm kommer den ikke frem —
helt sort, også hvis jeg åbner direkte." Årsag: `PlayerScreen` afgjorde radio
alene på navnet — `isRadio = /radio/i.test(channel.name) || isRadioKey(id)`. En
video-kanal med "radio" i navnet (fx en musik-tv-kanal) fik dermed radio-grenen
(linje ~713), som **skjuler** videoen (`hiddenVideo`) og viser radio-UI'et — så
i fuld skærm stod den sort, mens previewet (uden radio-grenen, samme adresse)
viste billedet fint. Fix: radio-behandling gælder nu kun ægte radio — en
internetradio-station (`isRadioKey`), ELLER en navne-match **der viser sig ikke
at have et billedspor**. `hasVideo` afgøres når streamen melder sine spor
(`videoTrackChange` → har billede; ved `readyToPlay` uden noget billedspor →
lyd alene). Indtil da vises billedet. Så en video-kanal med "radio" i navnet
viser billede; en ægte lyd-kun panelradio får stadig baggrundslyd + radio-UI.

**Guiden springer ikke til toppen vandret + Favoritter under Guide (v251).**
To ting oven på v250. (1) Brugeren: "når jeg scroller hen på den udsendelse der
er live, springer den også til toppen." Samme rod som det lodrette: gitterets
`autoFocus` sender fokus til øverste række, hver gang den fokuserede celle
**afmonteres**. Cellerne var kodet på indhold (`gap-<tid>` / `p-<start>`), så
når et hul blev til en udsendelse (data lander) eller vinduet flyttede sig, fik
cellen en ny nøgle → React afmonterede den fokuserede celle → fokus tabt → top.
Fix i `GuideRow` (`GuideScreen.tsx`): React-nøglen er nu **pladsen** i rækken
(`cell-${index}`), ikke indholdet. Så opdateres samme celle på stedet, og fokus
bliver siddende gennem både data-landing og vindues-skift. layout.ts's egne
`cell.key` (brugt af genopretnings-logikken til at finde samme udsendelse) er
uændrede. (2) **Favoritter flyttet op under Guide** i menuen
(`home/HomeScreen.tsx` `TABS`): de to hører sammen (guiden viser netop
favoritterne), så man kan springe mellem dem uden at gå forbi Film/Radio/
Kanaler.

**Guiden springer til toppen — den RIGTIGE årsag (v250).** v248 (baggrunds-
hentning af EPG) ramte ikke: brugeren meldte "når jeg kører ca. 18 kanaler ned
i guiden springer den til toppen igen." Det tal er nøglen. Gitterets FlatList
havde `initialNumToRender={16}` og `windowSize={5}` — altså **virtualisering**:
ruller man forbi de første ~16 rækker, afmonterer/genbruger FlatList rækker
uden for vinduet. På tv betyder det, at den række fjernbetjeningen står på, kan
blive revet ned under en — fokus mistes, og `autoFocus` på gitterets
TVFocusGuideView kaster det tilbage til øverste række. Det var ikke tomme
celler (v248), det var virtualiseringen. Fix i `features/guide/GuideScreen.tsx`:
på tv tegnes **alle** favorit-rækker fra start og holdes i live
(`initialNumToRender`/`windowSize`/`maxToRenderPerBatch` sat til
`channels.length` på tv; uændret på telefon, hvor der ingen fokus er at miste).
Guiden viser kun favoritterne, og rækkerne har fast højde + `getItemLayout`, så
det er billigt. Nu forsvinder den fokuserede række aldrig, og springet er væk.
`removeClippedSubviews={false}` (fra v241) var nødvendig men ikke nok alene:
den stopper klipning af monterede views, ikke selve virtualiseringen.

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

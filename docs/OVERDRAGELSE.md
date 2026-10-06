## v374 — direkte HD-trailere på Google TV (6. oktober 2026)

TV bruger Apple/IMDb og den native afspiller; ingen YouTube-, PO-token- eller
WebView-afspilning i TV-forløbet. Apple søges i native-kataloget (`pfm=appletv`),
Danmark først og USA som reserve. Webkataloget overså køb/leje-film, selv når
traileren kunne åbnes direkte. Præcist titel-/år-match og IMDb-suggestion som
reserve uden TMDB-nøgle; forsigtig slut-r-variant til fx “Vores løfter”.

HLS vælges som H.264/AAC i HD (1280–1920 pixel bredde, højst 1080 højde;
biografformat tilladt). Valgte video-/lyd-playlister skal være afsluttede og
uden kryptering, 60–360 sek. IMDb bruger kun direkte MP4 i mindst 720p på TV.
Ingen SD/HEVC/4K-reserve på TV. Native buffer 90 sek., minimum 4 sek., loft
64 MiB; kildefejl går videre i en afgrænset kø. IMDb-URL kan fornys højst to
gange for samme klip og position. Trailerafspilleren fylder TV-fladen og
bevarer billedformatet. Telefonens YouTube-reserve er fortsat separat.

Live målinger før udgivelse: Vores løfte på Apple i 1920×1038, ca. 122 sek.;
Oppenheimer og Dune 2 på IMDb i 1920×1080, 187/160 sek. Hele video/lyd
FFmpeg-dekodet uden fejl. Appens faktiske kildevalg testes også mod live API.
Ingen fysisk Google TV- eller udbydertest; ingen garanti for alle titler.

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

**4. oktober 2026 (v369).** Brugeren: "Lav 1 og 2 … du skal bare bygge videre." Tjeneste-filteret er nu fuldt: baggrundsjobbet (`sync/vodMeta.ts` `fillProviders`, anden runde efter genre/år) slår per titel op hos TMDB hvilke tjenester den ligger på i Danmark på abonnement (`sync/tmdb.ts` `watchProviders`, `/{movie|tv}/{id}/watch/providers`, kun `flatrate`), gemt i `vod_posters.providers` (skema v27, pakket ",8,119,"; "ingen" = '' så der ikke spørges igen). Udvalg → Tjeneste tæller nu både tjeneste-listens titler (`keys`) og titler med tjenesten i eget opslag (`fp.providers LIKE`), så det vokser til hele kataloget efterhånden. **Plakaterne får et mærke** ("Netflix", "Prime", "Disney+") i nederste højre hjørne overalt i Film, for de tjenester der er valgt til forsiden (`ui/serviceBadges.ts`, `StoredVodItem.providers`). Loggen: `baggrund: tjenester: N opslag hos TMDB, M ligger paa en tjeneste i DK`. 794 tests. Brugeren kører selv Codex' v366 og bygger selv fra grenen; herfra pushes der kun.

**4. oktober 2026 (v368).** Brugeren: "kan man vælge film og serier fra Netflix under Film? Vi skal kun se det vi har i pakken." Udvalg har fået knappen **Tjeneste** (`features/vod/serviceMatch.ts` `titlesInPackage`): TMDB's liste over det tjenesten har i Danmark (abonnement, de 5 mest populære sider à 20, per slags), skåret ned til pakken — først på TMDB-id (`vod_posters.tmdb_id`, skema v26, skrives af plakatopslaget og baggrundsjobbet; `itemKeysByTmdbIds`), så på navn og år som forsidens "Fordi du så …" (`panelMatch.findInPanel`). Svaret huskes en time per tjeneste og slags og bliver `keys` på udvalget (`i.key IN json_each`), så land/genre/år lægges oveni. Tjenesterne er dem der er valgt til forsiden under Indstillinger; valget huskes (`providers`). Teksten siger "N film i din pakke af M på tjenestens liste". Loggen: `baggrund: tjeneste Netflix (film): M paa listen, N i pakken (K paa navn)`. 4 nye tests (792). Samme forbehold som v367: ikke udgivet herfra, grenen rummer Codex' PO-token-arbejde.

**4. oktober 2026 (v367).** Brugeren: "under Film kan man dele det op i genrer og måske også årstal, så jeg kan vælge thriller 2026 … og vælge land, måske flere lande, DK, UK, US." Bygget som **Udvalg** (`features/vod/VodFilterScreen.tsx`): oeverst under Film → (land-listen) → "Udvalg: genre, år og land". Fire knapper (Land, Genre, År, Sortér) åbner en række valg; lande og genrer kan vælges flere af, år som 2026/2025/2024/2020–2023/2010–2019/Før 2010, sortering nyeste/bedst bedømt/årstal/titel. Valget huskes per slags (`vodFilterState.ts`, settings `vod_filter:<kind>`). SQL i `storage/vod.ts` `listVodItemsFiltered`/`countVodItemsFiltered`: land og genre fra kategorinavnet (`storage/genres.ts`, én kanon med danske/engelske ord og TMDB-id'er), genre også fra TMDB (`vod_posters.genres`, pakket ",a,b,") og panelets eget genrefelt (`vod_details.genre`); år = TMDB's før panelets. Id-lister som JSON via `json_each`. **Berigelse i baggrunden** (`sync/vodMeta.ts` `enrichVodMeta`): to minutter efter start og når Udvalg åbnes slås de nyeste titler uden genre/år op hos TMDB (300/150 ad gangen, 120 ms imellem), gemt i `vod_posters` (skema v25: kolonnerne `genres`, `year`; fundet uden genre = '' så den ikke spørges igen; nej = NULL, spørges igen efter 30 dage). Plakatopslaget gemmer nu også genre og år. Loggen: `baggrund: film-info: N opslag hos TMDB, M fundet, S s`. Kræver TMDB-nøgle (som plakaterne). 18 nye tests (761 i alt). **Ikke udgivet herfra:** grenen rummer også Codex' v366/v367 (robot-bevis/PO-token til YouTube), som ikke bygges eller udgives fra denne session; Udvalg ligger ovenpå. Skal Udvalg på tv uden beviset, lægges det på en ren gren fra v365 (f10b21d) og udgives derfra.

**6. oktober 2026 (v373).** Start forfra under en igangværende udsendelse: rettet dokumenterede appfejl med dobbelte streamåbninger, ny native afspiller ved hvert URL-skift, genforsøg der blev nulstillet uden fremdrift, og minut-seek der blev brugt på en gammel kilde. Nu én vedvarende afspiller, serialiseret `replaceAsync`, seek før play, genindlæsning af samme URL og en arkivbuffer på 90 s med 5 s startbuffer fra både guide og live. Første arkivindlæsning får 30 s; live får 8 s. Retry-budgettet kræver ti sekunders reel afspilning for at blive nulstillet. To tomme fortsættelser ved samme absolutte sekund stoppes. Kildeskift, zap, Tilbage og pause under indlæsning er dækket. Positivt seek starter først ved en frisk, bekræftet native position; en klar TS-kilde der ignorerer seek får efter 8 s et HLS-forsøg ved samme position (path-dialekt). Det negative seek-tilfælde er testet uden afspilning af gamle sekunder. Minutafrunding overholder 90 s afstand til live; programmets sidste 30 s droppes ikke længere, og appen venter ved sin position når sidste arkivminut mangler. **1075 tests (823 app, 248 core, 4 radio), typekontrol og Android/Hermes-bundling bestået.** Se `docs/ANDROID-TV.md`, v373. **Ikke fysisk prøvet på boksen eller brugerens arkivserver**: Panelets protokol og normale formatvalg er bevaret, med HLS-forsøget ved et ignoreret TS-seek. Et endeligt TS-arkivstykke skal stadig erstattes ved sin slutning; denne udgave lover ikke sømløse styk-skift eller fejlfri afkodning.

**3. oktober 2026 (v367, trailerens fuldskærm og danske søgninger).** Brugeren viser blå appkant omkring traileren og manglende “Vores løfter”; den officielle video er **Vores løfte | Trailer**, Nordisk Film, `-711Ef0I7Jc`, 117 s. Trailer-ruten har nu samme fuldskærmslærred som film/TV uden safe-margin. Native video fylder fladen; knapper ligger ovenpå og skjules efter fem sekunder via eksisterende LandscapePlayer. OK pauser, venstre/højre spoler, op viser knapper. YouTubes officielle reserve får en sammenklappelig bjælke uden at afmontere/genindlæse WebView. Originalt billedformat bevares; biografformat kan have sorte bjælker.

Søgning prøver dansk titel først, derefter original/engelsk; med år, uden år og en forsigtig slut-r-variant. Match tolererer æ/ø/å skrevet ae/oe/aa og én slut-r/s-forskel i titler med mindst to ord. Distributører prioriteres; anmeldelser, scener, forkerte film, efterfølgere og andre årstal afvises. Desktop/mobil-renderer, varighed i thumbnail og gentagne resultater samles; manglende varighed kontrolleres i afspilleren. **Faktisk YouTube-HTML verificeret:** både “Vores løfte” og paneltitlen “Vores løfter” finder Nordisk Films video som første kandidat.

**Kvalitetsfejl fundet:** beviskoden læste kun første `ytcfg.set`, men YouTubes aktuelle desktopside placerer VISITOR_DATA i senere kald. Nu samles alle felter med den aktuelle sessions visitorData; ingen opdigtet session. Verificeret mod faktiske desktop- og Android-WebView-sider og regressionstest. Googles YouTube-hostede `/js/`-fortolker tillades også. Native YouTube viser hentet opløsning i bjælken; officiel reserve viser rapporteret kvalitet. PO-token og præcis kontrol af begge hele filer bevares. Måleskriptet prøver også Nordisk-filmen og oplyser fejlfase uden adresser/tokens. Dette dokument lover ikke hardwaretest eller perfekt afspilning. TV-build og udgivelse skal verificeres inden brugeren får “klar”.

**3. oktober 2026 (v366, udgivet; hardwaretest mangler).** Brugeren har nu udtrykkeligt bedt om PO-token til Google TV Streamer. Den tidligere instruktion om aldrig at bygge det er derfor erstattet af dette valg. Tv: Apple TV → IMDb → YouTube med ægte BotGuard/WebPO i boksens egen WebView. Frisk YouTube-konfiguration, EVENT_ID og visitorData bruges sammen med udfordringen; sessionsbevis til MWEB-player og videospecifikt GVS-bevis. YouTube.js dechifrerer signatur og n; ingen webtoken på IOS/VR. **Begge hele filer hentes først til midlertidig cache, og præcis filstørrelse kontrolleres inden native DASH-afspilning** (H.264/AAC foretrækkes, op til 1080p). Det koster ventetid ved starten, men fjerner netafhængigheden midt i afspilningen. Bevis/URL/hentefejl giver officiel indlejring i appen; native codec-/afspilningsfejl giver samme indlejring fra den aktuelle position. Ingen automatisk ekstern YouTube-app.

**Målt, ikke antaget:** rigtig challenge → GenerateIT → minter → MWEB → decipher lykkedes for Oppenheimer `uYPbbksJxIg` (187 s, 1080p, video 41.335.997 bytes + lyd 3.021.758) og Dune 2 `Way9Dexny3w` (144,195 s, 1080p, video 25.888.006 + lyd 2.334.797) med den genererede browserkode i et DOM-testmiljø. Dette er **ikke** en hardwaretest. Videoværterne og Chromium-download er blokeret i udviklingsmiljøet (HTTP 200 med 195-byte HTML-fejlside), så hele videofiler og faktisk ExoPlayer-afspilning er endnu ikke verificeret. Koden accepterer aldrig dette som en hel fil. Næste kontrol er TV-APK på brugerens boks samt `YouTube PO:`-linjerne i Vis loggen; tokens/adresser logges ikke. Perfekt kvalitet eller universel tilgængelighed er ikke lovet.

Apple læser også `movieClips`, prøver næste titelvariant ved tom side og vælger et aktiv med HLS. IMDb læser 50 videoer og accepterer HLS som reserve. YouTube-søgning parser hele JSON-objektet og afviser andre film. Den indlejrede afspiller har stabil WebView-source, korrekt app-referer, ingen gamle kvalitet-/pause-hacks, fremdriftsvagt og højst to genoptagelser. Native Apple/IMDb har samme frostkontrol og større buffer; IMDb får højst to friske adresser. Alle opslag og PO-hentninger afbrydes ved Tilbage. `npm ci` genererer det 681 kB store browserbundle fra fastlåste BgUtils 4.0.3 og YouTube.js 18.1.0; licenser følger med. Android/Hermes-eksport, types og tests er kørt. Manuelt workflow-build til tv er stadig nødvendigt.

**3. oktober 2026 (v365).** Brugeren: "mange trailere kører ikke; kan den finde dem på YouTube og vise dem inde i appen, kan vi bygge vores egen afspiller?" Svar: appen finder allerede på YouTube (TMDB, udbyder, Data API, YouTubes søgning uden nøgle) og har Apple TV og IMDb først. En **egen afspiller til YouTube-filer kan ikke bygges** — de stopper efter ~1 minut uden robot-beviset (v329–v334 var netop det; "Byg det ALDRIG", v333). "Inde i appen" = YouTubes egen indlejrede afspiller (IFrame-API), som telefonen bruger. v365: **tv spiller YouTube-trailere indlejret i appen igen** (v354 sendte tv'et til YouTube-appen først, aldrig bekræftet virkende); YouTube-appen er nu sidste udvej med den bedste kandidat når ingen kunne vises indlejret; traileren lukker når den er slut (`ended`). **Loggen får en `trailer:`-linje per kilde** (Apple TV, IMDb, TMDB, udbyder, Data API, søgning), ved valg af kandidat, ved indlejrings-fejlkoder i ord (100 fjernet, 101/150 må ikke indlejres) og når en Apple/IMDb-trailer stopper med grund. Næste "kører ikke" → Vis loggen siger hvilken kilde og hvorfor.

**2. oktober 2026 (v364).** "404-fejlen er væk, men EPG virker stadig ikke på den nye boks (sat op i går, mens fejlen var der); de andre kører fint." Fundet i koden: den daglige forhåndshentning af favoritternes programtabel (`sync/prefetchEpg.ts`) satte sit døgn-mærke også når ALLE kanaler fejlede (404 tæller som "fejlet", ikke som undtagelse), så en boks sat op under udfaldet ventede et døgn efter at panelet var tilbage. Nu sættes mærket kun når noget blev hentet, eller intet fejlede; loggen siger `favoritternes EPG: intet hentet, N fejlede (grund): prøver igen ved næste start`. Testet. Afventer Test programoversigten + Vis loggen fra den nye boks for at se om der er mere.

**2. oktober 2026 (v363).** Brugeren prøvede Streamformat = HLS på start forfra: "det går galt med HLS også". Så beholderen er ikke årsagen. v363 (udgivet; 362 udgives ikke for sig) lægger to ting i loggen: ved frost `(buffer til N s)` fra `player.bufferedPosition` — buffer langt foran positionen = dekoderen/uret står med data; buffer ≈ position = sultet trods status "spiller" — og `klar (arkiv, ts|hls)`. Næste log afgør vejen.

**2. oktober 2026 (v362).** Log fra tv'et efter en "tosset" start forfra (Go' morgen-udsendelse 06:30–12:00, trykket 08:57): det er **frost-vagten (v353)** der slår til, ikke buffering — "billedet står stille ved 78 s i 12 s: genforbinder" og igen ved 142 s, begge ca. 1½ minut efter start af stykket; tredje stykke kørte stabilt i 4+ min. Hver genforbindelse beder om arkivet fra det hele minut + spol, og dét er hoppene i lyden. Fundet og rettet: fra guiden skabes afspilleren uden kilde, og `play()` på en tom afspiller melder "spillet til ende" → appen tog det for "indhentet live" og bad om **live-strømmen et sekund før arkivet** (to forbindelser i træk; skiltet "Du er nået til direkte" blev stående). Nu ignoreres det (`arkiv: spillet til ende uden arkiv-stykke`), og skiltet nulstilles ved nyt start forfra og zap. Hvorfor billedet fryser med status "spiller" er ikke set endnu: næste skridt er Streamformat = HLS (kan spoles i, EXT-X-DISCONTINUITY) og Test start forfra. Også GitHub-måling `scripts/maal/panelveje.mjs`: panelets EPG-veje (get_short_epg, xmltv.php) svarer **404 fra nginx for alle** (login svarer 403), så den nye boks' manglende EPG er panelets, ikke appens; den gamle boks kører på gemt EPG.

**1. oktober 2026 (v361).** Tv: "opdateringen bliver bare ved med at stå på 0 % og kommer ikke videre." Hentningen (`createDownloadResumable`) havde ingen tidsgrænse, og den igangværende blev genbrugt ved næste tryk, så man kunne hverken komme videre eller prøve igen. Nu en vagt: ingen nye bytes i 45 s → afbrydes, bjælken siger "Hentningen gik i stå ved N %…", og næste tryk på Opdater henter forfra. Loggen får `opdatering:`-linjer. v360 (spøgelser i oversigten) er med; 360 blev ikke udgivet for sig.

**1. oktober 2026 (v360).** Sport: "vælger håndbold, men kanalen sender basketball — tager den sidste uges oversigt?" Ja, i praksis: programmer gemmes med nøglen (kanal, starttid), så et program der FLYTTEDE sig i panelets næste oversigt blev liggende ved siden af det nye (spøgelser), og Sport fandt spøgelset som "LIVE NU". Nu erstatter hver hentning (nu/næste, hele tabellen, panelets fil, egen XMLTV) kanalens programmer i det tidsrum batchen dækker (`upsertProgrammes(…, { replaceWindow: true })`, testet). Fortiden uden for tidsrummet røres ikke.

**1. oktober 2026 (v359).** Ny boks: "Stadig 404" efter 358, så den huskede adresse var ikke hele forklaringen (eller slet ikke). Test programoversigten viser nu også: panelets adresse (skema, navn, port, evt. sti — uden login), om login på player_api.php lykkes, og om kanalkategorier kan hentes, lige før EPG-kaldet. Så kan to bokse sammenlignes linje for linje. Mistanker der er åbne: en sti i den gemte adresse, flere adresser bag panelets navn (load-balancer uden EPG på nogle), eller et panel der svarer 404 på EPG for netop den linje. Afvent billedet.

**1. oktober 2026 (v358).** Ny boks: Test programoversigten viste samme danske panel som det gamle tv (DR1 med EPG-id), kanallisten hentet, men **HTTP 404** på både EPG-kaldet og EPG-filen; det gamle tv virker. Fundet: DNS-nødudgangen (`withDnsFallback`) huskede en adresse i en time, så snart den svarede med *noget*, også 404 — og en pinnet adresse blev kun glemt ved netfejl, aldrig ved 404. Når navnet ikke når frem som Host-hoved, svarer serverens standardside 404 på alt. Nu: 404 fra adressen = "ikke panelet": huskes ikke, og en husket adresse der svarer 404 glemmes, så navnet prøves igen. Loggen får `net:`-linjer, og Test programoversigten viser "Vejen til panelet: på navnet / via en husket adresse". Om det er HELE forklaringen på den nye boks, bekræftes af rapporten efter 358.

**1. oktober 2026 (v357).** Ny boks (sat op fra sky-kopi): "EPG kommer ikke på, selv om man har stået på favoritter i 20 minutter." Fundet i koden: `ensureEpg`/`ensureFullEpg` slugte alle fejl per kanal (netfejl, 403, panelets nedkøling bliver til `XtreamNetworkError` i klienten), så guiden stod stille tom. Nu tælles de (`failed`, `reason` i `EnsureEpgResult`), loggen får `epg:`-linjer, nedkølingen skriver `panel: panelet afviste …`, og guiden viser en bjælke "Programoversigten kunne ikke hentes fra panelet: …" når alle hentninger fejler. Årsagen på den nye boks kendes IKKE endnu — afvent bjælken/loggen eller Test programoversigten.

**1. oktober 2026 (v356).** Tv, opsætningsskærmen: "Kan ikke komme ned i Dit kodeord når jeg skal på første gang." Pilene når ikke et tekstfelt fra fanerne, og knappen er slået fra indtil feltet er udfyldt. Nu får det første felt fokus selv (`.focus()` 250 ms efter åbning og ved fanevalg), og tastaturets "næste" flytter mellem felterne (adresse → brugernavn → adgangskode) på tv. Samme mønster som resten af appen (ANDROID-TV.md: pil ned mellem tekstfelter er upålidelig).

**1. oktober 2026 (v355).** Brugeren: "Kan vi ikke gøre så den buffer løbende, det må da give et bedre flow." Appen kan ikke selv (panelet tillader én forbindelse: ikke både optage live og hente det der gik forud). En løbende buffer kan kun komme fra panelet, som hos TV 2 Play. Om panelet leverer arkivet som en HLS-spilleliste der **vokser**, afgøres nu af **Indstillinger → Test start forfra** (`features/player/timeshiftProbe.ts`, testet): A) HLS fra start til slut læst to gange med 30 s imellem (vokser?), B) HLS kun det der findes, C) .ts-hovederne (Content-Length = færdig fil). Konklusionen står nederst. Vokser den → næste skridt er at spille den som live med spoling (ét flow). Afvent skærmbillede.

**30. september 2026 (v354).** Brugeren: "Det der med skift i trailer til lavere kvalitet med YouTube fungerer ikke, så vi skal have lavet en ordentlig løsning." Den native YouTube-vej og blandingen (v329–v334) er **fjernet**. Apple TV og IMDb er stadig først. Når kun YouTube er tilbage: **på tv åbnes YouTube-appen** med traileren (fuld kvalitet, fjernbetjeningen virker; skærmen lukker når man kommer tilbage), ellers YouTubes indlejrede afspiller; **på telefonen** YouTubes egen afspiller fra start. Robot-beviset (PO-token) bygges stadig ALDRIG.

**30. september 2026 (v353).** Brugerens to skærmbilleder af guiden viste fejlen: pil venstre fra Regionalprogram 19:30 (første celle) landede på 18 News 18:00 — forbi 19 News og Go' aften. v348 tog den *første* celle i rækken når udsendelsen var røget ud af det nye vindue; det skulle være den *sidste* før den. Nu findes naboen på **tid** (`neighbourIndex` i `guide/layout.ts`, testet): venstre = sidste udsendelse der begynder før den man stod på, højre = første efter; huller tæller. Den fokuserede celle tegnes i accentfarve på tv, så man kan se hvor man er. Og afspilleren får en **frost-vagt**: melder afspilleren 'spiller' men positionen står stille i 12 s, genforbindes der (som at gå ud i guiden og ind igen, hvilket brugeren gjorde manuelt). Loggen skriver `billedet staar stille …`. NorRadio-rettelsen (sortering) er også med i NorStreams radio-fane.

**30. september 2026 (NorRadio: sortering).** "Hver gang jeg forsøger at trække en op, så smutter den ned igen." `RadioSortList` regnede fingerens plads ud fra listens position på skærmen målt med `measureInWindow` i `onLayout` — på Android giver det 0 (eller status-bjælkens højde ved siden af), så den beregnede plads lå rækker UNDER fingeren. Nu bruges `locationY` på træk-laget (der dækker præcis listen), så ingen måling behøves; `reorderRadioFavorites` skriver i én transaktion. Samme komponent bruges af NorStreams radio på telefonen.

**29. september 2026 (v352).** Brugeren: "Ved ikke om det kun er 150 ud af de 22.000 kanaler der er." Rigtigt set: 150 er et loft, og en pakke på 22.000 kanaler har typisk et par tusind der ligner sport. Panelet spørges stadig kun for 150 (ét kald per kanal), men **panelets EPG-fil** dækker nu **alle** pakkens sportskanaler (`FILE_SPORT_CAP = 2500`, bedste først) i én hentning om dagen, læst ud i klumper af 300 feed-id'er (`PROGRAMME_CHUNK`), så native-svaret aldrig bliver stort.

**29. september 2026 (v351).** Brugeren: "Jeg vil faktisk godt have sport stadig tager alt med, men den skal bare gøre det stille i baggrunden." Så alle 150 sportskanaler hentes igen (`SportChannels.api` er væk, kun `refresh`), men i køen bag alt synligt og med 1 s pause mellem kaldene (`BACKGROUND_PAUSE_MS` i `epgCache.ts`); hele runden tager nogle minutter, og det er meningen.

**29. september 2026 (v350).** "Hele appen kører super langsomt og indlæser hele tiden." Årsag (fra koden; skyen frikendt — kun to kopier ligger der): siden v339 hentede Sport hele programtabellen for **150** kanaler i baggrunden (alle sportskanaler i verden), samtidig med at forsiden, guiden og kanallisten bad om deres — mod et panel der kun tåler ét kald ad gangen. Nu: **én kø for alle panelkald** (`sync/panelGate.ts`), forgrund før baggrund; Sport spørger kun favoritter + sport fra favoritternes lande (højst 60, `SportChannels.api`), resten kommer fra panelets EPG-fil; sport-hentningen starter først 90 s efter start; EPG-filens hentning står også i køen. Baggrundsjobs skriver varighed i loggen (`baggrund:`). Indeholder også v349 (loggen), som aldrig blev udgivet.

**29. september 2026 (v349).** Brugeren har 348 på tv'et, og alle tre fejl (start forfra fryser efter ~1 min, guiden springer udsendelser over i kanten, bjælken kan ikke nås) gælder stadig — så ingen flere gæt: appen har nu en **fejlfindings-log** (`src/diagnostics/log.ts`, ring på 300 linjer, adresser fjernes). Afspilleren skriver hvad den beder om (arkiv fra/længde/offset), hvornår den er klar, buffrer, fejler, prøver igen, skifter format og opgiver; guiden skriver kant-tryk. Indstillinger → avancerede → **Vis loggen**. Næste skridt: brugeren fremkalder fejlene og sender et skærmbillede af loggen; ret derefter ud fra det den viser.

**29. september 2026 (v348).** Tv: (1) opdaterings-bjælken kunne ikke nås med pilene (den ligger uden for indholdets fokusfælde, og knappen bad om fokus fast → greb det ved hver procent-opdatering); nu én puls ved visning og når filen er hel. (2) Guiden: pil venstre/højre i kanten lander nu på nabo-udsendelsen efter vinduesskiftet ('<'/'>' foran nøglen), ikke den samme igen — en kort udsendelse i kanten kunne springes over. (3) Start forfra på igangværende udsendelse meldes stadig fejlende — men tv'et kører formentlig stadig 339 (opdatering aldrig gået igennem); v347-rettelsen er ikke prøvet endnu. Anbefalet vej: Send files to TV med NorStream-TV.apk.

**28. september 2026 (v347).** Start forfra på en udsendelse, der stadig sendes, frøs efter ~1 minut på tv (færdige udsendelser spillede igennem). Årsag: arkivet blev bedt om helt til udsendelsens slutning, altså ud i fremtiden. Nu bedes der kun om det, der ligger i arkivet (til 90 s før nu); når stykket er spillet, henter `archiveContinuation` det næste, og til sidst live. Bygget sammen med v346 (Sport i baggrunden).

**28. september 2026 (v346).** Sport henter i baggrunden: sportskanalernes programoversigt hentes 30 s efter start (HomeScreen), ikke først når fanen åbnes; Sport viser listen fra databasen med det samme og kun en lille linje "Opdaterer … i baggrunden", hvis en hentning faktisk tager over 0,8 s. Panel-filens time-genkørsel udløses nu kun af kanaler, der aldrig har været forsøgt (før hver time, så længe én favorit manglede).

**28. september 2026 (v345).** Stadig ingen EPG på telefonens GOLD-fil efter v344 (skærmbillede: alle favoritter "Ingen programdata"). Nok gættet: v345 giver **Indstillinger → Programoversigt → "Test programoversigten"**, som kører hele vejen uden tidsgrænser og skriver trin for trin (favoritter uden EPG, panelets svar per kanal, filen hentet/antal kanaler, parret/ikke parret med filens navne og lande, programmer skrevet). **Afventer brugerens skærmbillede af rapporten.**

**28. september 2026 (v344).** Telefonen havde stadig ingen EPG efter v343. Skærmbillede: kanalerne hedder `GOLD: DR 2 RAW`, `GOLD: DR1 SY…`. `normaliseChannelName` fjernede kun præfiks før `|`, så nøglen blev `GOLDDR2` og matchede hverken programfilen (`DR2`) eller logo-registret. Nu fjernes også et ét-ords præfiks med kolon (`GOLD:`, `UK:`); `MATCH_KEY_VERSION` 5, så kanalerne hentes igen med nye nøgler ved første start.

**28. september 2026 (v343).** Bruger (telefonen, med en anden fil/kilde): "der kommer slet ikke noget EPG frem på nogen af kanalerne, men Sport finder en masse." Sport fandt det, v342 hentede fra panelets fil for sportskanalerne; favoritterne kom først med i filen når panelet var spurgt per kanal (`epg_fetch`) — og den daglige kørsel var løbet før det, så de stod uden EPG et døgn. v343: alle favoritter uden programmer forude tages med, og filen hentes igen efter en time når listen af kanaler at hente for har ændret sig (ny favorit, nyt hold), ikke først om et døgn.

**27. september 2026 (v342).** Sport: "Formel 1" gav mange kampe på telefonen og én på tv'et. Årsag: de fleste sportskanaler (UK, US …) har intet EPG-id, så panelet giver dem ingen programmer per kanal; de får kun programmer fra panelets XMLTV-fil, som hidtil kun blev læst for **favoritter** — så Sport fandt kun det, favoritterne (flest på telefonen) dækkede. Nu læses filen også for sportskanalerne (≤150), Sport venter på begge hentninger, og skjulte lande findes stadig (bagerst). v341 (opdateringen siger hvorfor) er udgivet på begge mærkater.

**27. september 2026 (v341).** Brugeren (tv): "pop up kommer, installationsskærmen kommer, jeg trykker Installér, men appen er stadig den gamle — kører i ring." Filen på GitHub er tjekket rigtig (versionCode 340, samme debug-signatur 5E:8F:16:06 som telefonens). Årsagen er ikke set på boksen; v341 gør opdateringen til at stole på og får Androids eget svar frem (se nedenfor). **Afventer brugerens svar med teksten fra bjælken.**

**27. september 2026 (v340).** Fire nye ting, valgt af brugeren ("Byg 3-4-5-6"): kanalliste oven på billedet i afspilleren, "I aften" på forsiden, enhederne holdes ens gennem skyen (løbende synk), "Fordi du så …". Afventer brugerens test.

**27. september 2026 (v339).** Brugeren: "super godt lavet det med sport". "Find kampen": ny fane Sport — søg hold/liga i programoversigten på tværs af kanalerne, Mine hold, "Dine hold i dag" på forsiden, automatisk påmindelse.

**27. september 2026 (v338).** Danske undertekster fra OpenSubtitles; NorStream i Google TV's "Fortsæt med at se". Trailere: Apple TV → IMDb → YouTube.

**26. september 2026 (v335).** Brugeren: "Fantastisk, endelig kører det også,
EPG ser også ud til at køre nu." Trailere fra IMDb i 1080p (v335) og
UK/US-programoversigt fra panelets egen `xmltv.php` (v320+) er bekræftet af
brugeren. Stadig åbent: start forfra på en udsendelse der sluttede for 2–3 timer
siden (afventer brugerens test), Android Auto-listen der hopper til toppen
(afventer billede af loggen), og `latest-norradio` der ikke fik ny fil.

**23. september 2026.** Appen kører på brugerens to Google TV Streamere og
telefon mod det rigtige panel. Efter denne omgang (v317–v319) er brugerens ord
"nu kører det hele dejligt hurtigt igen og alt fungerer". Alt bygges via GitHub,
aldrig EAS; se `docs/BYG-FRA-CHAT.md`. Nyeste udgivelse: **versionCode 335** på
begge faste mærkater (`latest-norstream`, `latest-norstream-tv`).

**Vigtigste læring fra denne omgang:** på tv-boksens hardware er det at hente +
parse store XMLTV-EPG-filer for hver kilde ved hver synk for tungt — hele appen
blev ubrugelig langsom. Byg ALDRIG indbyggede standard-feeds eller XMLTV-parsing
på JS-tråden ind igen (det var v305/v314/v316-sporet, netto en fejlvej her).
Panelets egen EPG per kanal (`get_short_epg`) + panelets egen `xmltv.php` læst
**native i baggrunden, kun for favoritter uden EPG-id** (v320) er vejen. Og favoritter/grupper er
brugerens data: al gen-hægtning og gendan-matchning skal respektere **landet**,
ellers byttes danske kanaler til svenske (v319).

### 2. oktober 2026 — v362: start forfra bad om live-strømmen før arkivet; log-analyse af hoppene

Brugeren: "Start forfra på igangværende udsendelse virker, men de første par
minutter springer den frem og tilbage, går tilbage i lyden, fryser lidt i
billedet … efter 3 minutter stabiliserer det sig." Og: "Skulle den ikke køre
HLS i stedet for TS?" (Nej: v355 var kun målingen; afspilningen bruger .ts
som live, fordi HLS-arkiv gav grøn skærm på DR på tv. Streamformat i
Indstillinger gælder også start forfra, så HLS kan prøves uden ny udgave.)

**Loggen (Vis loggen, tv):**

```
08:56:59 arkiv: stroemmen sluttede ved 0 s (stykke fra ?) → live
08:56:59 arkiv: beder om php-arkiv fra 06:30:00, 146 min (… offset 120 min, spol 0 s)
08:57:01 afspiller: klar (arkiv)
08:58:36 afspiller: billedet staar stille ved 78 s i 12 s: genforbinder
08:58:38 arkiv: beder om php-arkiv fra 06:31:00, 147 min (… spol 19 s)
08:58:39 afspiller: klar (arkiv) · buffrer ved 0 s
09:00:17 afspiller: billedet staar stille ved 142 s i 12 s: genforbinder
09:00:19 arkiv: beder om php-arkiv fra 06:33:00, 146 min (… spol 22 s)
09:00:20 afspiller: klar (arkiv) · buffrer ved 0 s
09:04:42 afspiller: klar (live)   ← brugeren gik til live
```

Hvad den siger: ingen "buffrer"-linjer midt i afspilningen, så det er ikke
tomt buffer. Afspilleren melder "spiller", men tiden står stille — frost-vagten
(v353) genforbinder efter 12 s, fra det hele minut + spol frem. Det er
hoppene. To gange ca. 85 s efter stykkets start (vægur, ikke indhold:
06:31:18 og 06:33:22), tredje stykke uden frost i 4+ min. Årsagen til at
dekoderen stopper med data i bufferen ses ikke herfra (PTS-spring i panelets
sammenklippede arkiv? boksens hardware-dekoder? — det samme sås på live i
v353).

**Rettet (sikkert fra loggen):** den første linje. Fra guiden skabes
afspilleren med kilde `null` og `play()`; ExoPlayer melder straks STATE_ENDED
på en tom afspiller → `playToEnd` → handleren (restarted sand, intet stykke)
tog det for "indhentet live": `setSource(live)`, `setCaughtUpToLive(true)`,
og ét sekund senere satte `playFromStart` arkivet. Altså live-forbindelse +
arkiv-forbindelse i træk mod et panel med én forbindelse, hver gang fra
guiden. Nu: intet stykke → `arkiv: spillet til ende uden arkiv-stykke (tom
afspiller): ignoreres`. `caughtUpToLive` nulstilles i `playFromStart` og ved
zap (skiltet blev ellers stående).

**Næste skridt, i rækkefølge:** 1) brugeren prøver Streamformat = HLS på samme
udsendelse (HLS kan spoles i, så "spol 19 s" rammer; og
EXT-X-DISCONTINUITY håndterer spring). 2) Test start forfra-rapporten
(Content-Length på .ts = spolbar?). 3) Vokser HLS-arkivet → ét flow (v355-planen).

**Måling, panelets EPG-veje (`scripts/maal/panelveje.mjs`, motor `maal`,
testlegitimation):** `line.trx-hub.xyz` (én A-post, nginx): login,
kategorier, get.php, live .ts → HTTP 403 (nginx-side); `get_short_epg` → **404**;
`xmltv.php` med/uden login → **404**; IP direkte med/uden Host → 403. Begge
fejlsider er nginx' egne, så EPG-vejene er lukket på panelets webserver for
alle. Den nye boks' 404 er panelets; den gamle kører på gemt EPG. Vej frem:
sælgeren, eller en XMLTV-adresse på kilden (findes allerede under Kilder).

### 1. oktober 2026 — v361: hentningen af en opdatering kunne stå på 0 % for evigt

`downloadApk` ventede på `task.downloadAsync()` uden tidsgrænse. Kommer der
intet (netvej til objects.githubusercontent.com lukket, DNS der ikke svarer på
boksens net, et panel-tungt net), stod bjælken på "Henter 0 %" — og fordi
`inFlight` genbruges per udgave, gav et nyt tryk den samme hængende hentning.
Nu: `DOWNLOAD_STALL_MS = 45 s` uden nye bytes → `task.cancelAsync()` →
`stallError` ("Hentningen gik i stå ved N % — der kom ingenting i 45 s. Tjek
nettet på boksen, og tryk Opdater igen."), filen slettes, `inFlight` ryddes i
`finally`, og bjælken går til idle med beskeden; næste tryk henter forfra. Loggen:
`opdatering: henter udgave N (MB)` / `gik i staa ved …` / `hentet: … MB`.

Står den stadig på 0 % med 361: så er det boksens net der ikke kan nå GitHubs
filserver (en anden vært end api.github.com). Sideload fra udgivelsessiden er
vejen, og "Tjek forbindelsen" siger intet om den vært — overvej en linje for den.

### 1. oktober 2026 — v360: flyttede programmer efterlod spøgelser i oversigten

Brugeren: "Går jeg under Sport og vælger håndbold … så viser den basketball,
en helt anden udsendelse. Det er ligesom den tager programoversigten fra
torsdag i sidste uge." Mekanismen: `programmes` har nøglen (channel_id,
start_ms). En upsert overskriver kun et program med SAMME starttid. Sportskanalers
oversigter ændres hele tiden (kampe flyttes, forlænges, byttes): i går sagde
panelet "Håndbold 20:00–22:00", i dag "Basketball 19:30–21:30" — begge rækker
bliver liggende, og `searchProgrammes` finder håndbolden med LIVE NU (20–22
rummer nu), mens kanalen sender basketball. `getNowNext` tager den senest
begyndte, så guiden viste det rigtige — derfor så det ud som Sport var gal.
Oprydningen (`deleteProgrammesBefore`) sletter kun det der sluttede for over 7
dage siden, så spøgelser levede en uge.

Rettelsen: `upsertProgrammes(db, rows, { replaceWindow: true })` sletter per
kanal alt der overlapper [batchens første start, batchens sidste slut) før
skrivningen (én transaktion). Slået til i `ensureEpg` (nu/næste), `ensureFullEpg`
(hele tabellen), `syncPanelEpg` (panelets fil, per klump) og `syncXmltv`. Uden
option: som før (test bevarer det). Tests: `programmes.test.ts` (spøgelse væk,
anden kanal urørt, fortiden før vinduet bliver).

Bemærk: det gamle ligger stadig i databasen på boksene indtil næste hentning
per kanal (6 t for hele tabellen, ét døgn for filen); derefter er det rent.

### 1. oktober 2026 — v359: Test programoversigten viser adresse, login og kategorier

358 ændrede intet på den nye boks ("Stadig 404"). Faktum: på samme boks lykkes
login og kanallisten (connectXtream under opsætningen kører `authenticate` +
`syncChannels` med samme `creds.baseUrl`), mens `get_short_epg` og `xmltv.php`
svarer 404. `diagnosePanelEpg` printer nu `describeBase(creds.baseUrl)` (skema,
navn, port, sti — aldrig login), `authenticate()`-resultat og antal
kanalkategorier, umiddelbart før EPG-kaldet. Hvis login/kategorier er OK og EPG
stadig 404 på samme adresse, er det panelet selv der svarer forskelligt for den
boks/linje (eller én af flere servere bag navnet). Hvis adressen viser en sti
("← bemærk stien"), er det kopien der bar en forkert adresse med.

### 1. oktober 2026 — v358: DNS-nødudgangen huskede en adresse der svarede 404

Billedet fra den nye boks (v357, Test programoversigten): "Favoritter fra kilden:
89, uden programmer forude: 89. Første: DNK| DR1 HD → navn DR1, land DK, EPG-id
dr1.dk. Panelet per kanal svarede ikke: Panelet svarede med HTTP 404. Filen kunne
ikke hentes/læses: Panelet svarede HTTP 404." Det gamle tv virker på samme panel.

To forskellige EPG-adresser med 404, mens kanallisten findes: det gør et panel
ikke selv. Men serverens *standardside* gør, når kaldet kommer på adressen uden
panelets navn i Host-hovedet. `withDnsFallback` (v: DoH-nødudgangen): fejler
navnet én gang (en flig af DNS-udfald på en ny boks), slås det op via DoH, og
svaret fra adressen blev **pinnet en time uanset status** — også 404. Og den
pinnede vej blev kun forladt når kaldet *kastede*; et 404-svar holdt pinnen i
live. Kanallisten var hentet på navnet før omvejen, derfor så den fin ud.

- `doh.ts`: `notThePanel(response)` = status 404. Via DoH: et 404 pinnes ikke,
  næste adresse prøves, ellers den oprindelige fejl. Pinnet vej: 404 → `unpinHost`
  og navnet igen. Log: `net: …` i begge tilfælde og når omvejen tages.
- `panelEpg.diagnosePanelEpg`: linjen "Vejen til panelet: på navnet / via en
  husket adresse". Tests i `doh.test.ts` (to nye).

Åbent: om RN's fetch (OkHttp) overhovedet sender et `Host`-hoved sat fra JS. Gør
den ikke, virker DoH-vejen aldrig for API-kald (kun for streams, hvor ExoPlayer
sender hovedet), og så er rettelsen her det, der sikrer at appen i det mindste
falder tilbage på navnet og siger den rigtige fejl. "Tjek forbindelsen til
panelet" (ConnectionCheckScreen) måler netop "direkte på adressen med Host".

### 1. oktober 2026 — v357: EPG-fejl siges i stedet for at sluges

Ny boks sat op fra sky-kopien, 356 på: ingen programoversigt efter 20 min på
favoritterne, ingen besked. Hvad koden gjorde: `ensureEpg` fanger fejl per kanal
og går videre ("én død kanal må ikke tage EPG fra resten") — rigtigt, men
fejlede ALLE, sagde ingen det. Panelets nedkøling (`PanelCoolingDownError` fra
`withPanelCooldown`) kastes i `fetchImpl`, og `XtreamClient.request` pakker den
som `XtreamNetworkError("Kunne ikke nå panelet: …")` → slugt per kanal. Kun
`XtreamAuthError` (et 403 der NÅR klienten) går videre til `onAuthError`.

- `EnsureEpgResult` har nu `failed` og `reason` (første fejl, `safe`); begge
  funktioner logger `epg: nu/naeste|hele tabellen: X af Y kanaler hentet, Z
  fejlede: <grund>` når noget fejlede.
- `cooldown.ts`: `noteRejected` logger `panel: panelet afviste (401/403): appen
  venter 10 min …` ved starten af en nedkøling.
- `GuideScreen.loadVisible`: fejlede alle (fetched 0, failed > 0) →
  `Notice` "Programoversigten kunne ikke hentes fra panelet: <grund>".

Mulige årsager på en ny boks, som bjælken/loggen nu skelner: (a) panelet
blokerer adressen (ny boks spørger hårdt: kanaler, VOD, favorit-EPG, Sport,
EPG-fil) → "Panelet afviser lige nu"; (b) DNS/netvej ("Kunne ikke nå
panelet: …"); (c) panelet svarer, men tomt (ingen fejl, 0 programmer) →
kanaler uden EPG-id på DEN kilde → Test programoversigten. Først når grunden
kendes, bygges en rettelse (fx: ny boks henter mindre de første timer).

### 1. oktober 2026 — v356: opsætning på tv — kodeordsfeltet kunne ikke nås

Billede fra brugeren: fanen Sky-kopi valgt, feltet "Dit kodeord" tomt, knappen
"Hent fra skyen" nedenunder. Pil ned fra fanen lander ikke i tekstfeltet (kendt:
D-pad og RN's TextInput, se ANDROID-TV.md "Alle tekstfelter er TvTextInput"),
og knappen er `disabled` indtil kodeordet er skrevet — en slået-fra knap kan
ikke have fokus. Så var der ingen vej ind.

`OnboardingScreen`: `firstRef`/`userRef`/`passRef`/`xmltvRef`; på tv kaldes
`firstRef.current?.focus()` 250 ms efter at skærmen åbner og hver gang `kind`
skifter (fanen). Tastaturet kommer frem; Tilbage lukker det og fokus bliver i
feltet; pil op går til fanerne. `nextOrSubmit(ref)`: på tv flytter tastaturets
"næste" (`returnKeyType: 'next'`) fokus til næste felt, adresse → brugernavn →
adgangskode (→ forbind); M3U: adresse → XMLTV. Telefonen uændret ("go").

### 1. oktober 2026 — v355: Test start forfra — kan panelet give en løbende buffer?

Brugeren spurgte hvordan TV 2 Play gør (svar: "Start forfra" virker midt i en
live-udsendelse, kun på Samsung/LG/Apple TV, afhængigt af rettigheder; kilde:
play.kundeservice.tv2.dk) og dernæst: "Kan vi ikke gøre så den buffer løbende?"

Hvorfor appen ikke kan selv: panelets ene forbindelse. En lokal DVR skulle
optage live løbende OG hente arkivet for tiden før man tændte — to
forbindelser. Så bufferen kan kun komme fra panelets side: leverer det
arkivet som en HLS-spilleliste uden ENDLIST, der får flere stykker mens
udsendelsen optages, kan ExoPlayer følge den som en live/event-strøm med
spoling bagud — ét flow, ingen genhentninger, og live-kanten nås af sig selv.
Det er det, der skal måles, ikke gættes (v347 bad om "til slut" som .ts og frøs).

- **`features/player/timeshiftProbe.ts`:** `probeTimeshift(fetchProbe, creds,
  streamId, programme, dialect, offset, {now, waitMs, sleep, onProgress})` →
  rapport uden adresser. A: `buildTimeshiftUrl(..., 'm3u8')` fra start til slut,
  `readPlaylist` (stykker, sekunder, ENDLIST, PLAYLIST-TYPE, master-varianter
  følges), 30 s pause, læst igen → "vokser: JA (+N s)"/"nej". B: samme kun til
  nu − 90 s. C: `.ts` til slut, kun hoveder (HEAD, ellers GET med Range; løber
  tiden ud, er det en strøm uden ende). Tests: `timeshiftProbe.test.ts`.
- **`timeshiftProbeFetch.ts`:** rigtig `fetch` + `streamSource` (DNS-pin), fordi
  appens API-indpakning ikke giver hoveder. RN's fetch svarer først når hele
  kroppen er hentet — derfor HEAD/Range til .ts.
- **Indstillinger → Test start forfra** (ved siden af Test programoversigten):
  bruger den kanal man så sidst og dens igangværende udsendelse; kræver
  dialekt (ellers: åbn kanalen og tryk start forfra én gang) og programdata.
  Afspilleren skal være lukket (forbindelsen).

Næste skridt afhænger af rapporten: vokser den → ny afspilningsvej for
igangværende udsendelser: HLS-arkivet "til slut" som live-strøm (ExoPlayer
håndterer voksende spillelister selv), spol til 0, og lad `archiveContinuation`
være for færdige udsendelser. Vokser den ikke → stykkevis som nu, og så er
det hakket ved skiftet der kan gøres mindre (kortere stykker, hurtigere start).

### 30. september 2026 — v354: YouTube-trailere — appen på tv, YouTubes afspiller på telefon

Brugeren: "Det der med skift i trailer til lavere kvalitet med YouTube fungerer
ikke, så vi skal have lavet en ordentlig løsning."

Hvad der IKKE kan lade sig gøre, og hvorfor: YouTubes filer i appens egen
afspiller stopper efter ~1 minut uden YouTubes robot-bevis (PO-token). At lave
beviset selv er at omgå deres beskyttelse — det bygges ALDRIG (v333). Alt
oven på den grænse (v330–v334: genopretning, HLS, 720p, blandingen med skift
til YouTubes afspiller) var lappeløsninger, og skiftet endte i dårlig kvalitet.

Den ordentlige løsning er at bruge det, der VIRKER i fuld kvalitet:

- **Apple TV og IMDb først** (uændret, v335/v336): rigtige filer, ingen grænse.
- **Tv: YouTube-appen.** Google TV har YouTube-appen; den spiller i fuld
  kvalitet med fjernbetjeningen. `openInYoutubeApp(id, onReturned)` i
  `TrailerScreen`: `IntentLauncher.startActivityAsync('android.intent.action.VIEW',
  { data: youtube.com/watch?v=id, packageName })` med `com.google.android.youtube.tv`,
  så `com.google.android.youtube`, så `vnd.youtube:<id>` uden pakke. Afvises
  intentet med det samme (ingen app) → falsk → YouTubes indlejrede afspiller i
  webvisningen som før. Ellers regnes appen for åbnet efter 1,5 s
  (`LAUNCH_SETTLE_MS`); `startActivityAsync` venter på at aktiviteten lukker,
  og så kaldes `onBack()` — man lander på filmsiden. Kilde `external` viser
  "Traileren spiller i YouTube-appen" imens. Loggen: `trailer: aabnet i
  YouTube-appen` / `kunne ikke aabnes`.
- **Telefon: YouTubes egen afspiller** (`measured`) fra start, som før blandingen.
- **Fjernet:** `resolveYoutubeStream`-kaldene, `prepareStream`, `recoverNative`,
  standby/`handOver`/`onStandbyMessage`, `switchNote`, `bufferWatch`,
  `NativeTrailer.onProgress`, feltet `limited`. `youtubeStream.ts` bruges nu kun
  for `buildHlsMaster` (Apple); resten af filen er død kode og kan slettes,
  hvis ingen skal fejlsøge YouTube igen.

Ikke testet på boksen endnu: at Google TV's YouTube-app tager intentet med
`packageName` (ellers `vnd.youtube:`), og at `startActivityAsync` først svarer
når man er tilbage. Loggen viser hvilken vej der blev taget.

### 30. september 2026 — v353: guiden finder naboen på tid, markering, frost-vagt i afspilleren

Brugeren sendte to billeder: før (fokus på Regionalprogram 19:30, første celle i
TV 2-rækken) og efter ét tryk venstre (vindue 18:00–19:25, fokus på 18 News
18:00). "Springer over 2 programmer." Årsag i `GuideRow`: v348's
`found === -1 ? (side === 1 ? sidste : 0)` — ved pil venstre og en udsendelse
der ikke længere er i vinduet, blev det den FØRSTE celle. Det er vendt om og
gjort tidsbaseret: `neighbourIndex(cells, found, side, atMs)` i `layout.ts`,
hvor `atMs` er starttiden på den udsendelse man stod på (`focusedCell.atMs`,
sat i `onCellFocus`, sendt med i `focusTarget` og som prop `focusAtMs`).
Venstre = sidste celle med start < atMs (huller, start = null, tæller også),
højre = første med start > atMs. Test: `guide/neighbour.test.ts` med
brugerens række.

"Kan man lave en markering på hvilken udsendelse jeg er ved": på tv får den
fokuserede celle accentfarve og hvid fed tekst (`markedIndex` i `GuideRow`,
`cellFocused`/`cellTextFocused`) oven i TvPressables ring.

"Billedet fryser jævnligt ved fuld skærm, så skal jeg gå tilbage til guiden
og ind igen": afspilleren melder `readyToPlay` og `playing`, men tiden står
stille — ingen `loading`, ingen `error`, så stall-uret (`STALL_TIMEOUT_MS`)
kom aldrig i gang. Ny frost-vagt i samme effekt som stall-uret: hvert 3. s
sammenlignes `positionRef` med sidst; er `player.playing && status ===
'readyToPlay'` og positionen uændret i 12 s (`FROZEN_AFTER_MS`), kaldes
`handleFailure()` — samme genforbindelse som ved stall (og for start-forfra
fra det punkt man nåede). Pause og slut tæller ikke (playing er falsk).
Loggen: `afspiller: billedet staar stille ved N s i 12 s: genforbinder`.
Hvad der FÅR billedet til at fryse (panelets ene forbindelse? boksens
dekoder?) vides stadig ikke; loggen viser om vagten slår til og om
genforbindelsen lykkes.

### 30. september 2026 — NorRadio: træk-sorteringen landede rækker under fingeren

Brugeren: "Nordre Radio, der kan jeg ikke få lov at sortere. Hver gang jeg
forsøger at trække en op, så smutter den ned igen."

`RadioSortList` (v: markér-og-træk) regnede pladsen ud som
`pageY − listens top + scrollY`, hvor listens top kom fra `measureInWindow`
kaldt inde i `onLayout`. På Android er viewet tit ikke lagt på plads i vinduet
endnu i det øjeblik, så målingen gav 0 — og selv når den virker, kan pageY og
measureInWindow være forskudt med status-bjælken. Med top = 0 og en liste der
begynder ~200 px nede (header, faner, søgefelt, sortér-linje) lå den beregnede
plads 3 rækker under fingeren: stationen fulgte ikke fingeren, og et slip lagde
den længere nede. Præcis "trækker op, flytter ned igen".

Nu: træk-laget (`absoluteFill` over listen) er selv responder, og
`event.nativeEvent.locationY` er fingerens y **fra lagets egen overkant** =
listens overkant. Ingen måling, ingen status-bjælke. `onPanResponderGrant`
sætter pladsen med det samme; rul-ved-kanten bruger lagets højde fra
`onLayout`. `reorderRadioFavorites` skriver positionerne i én transaktion, så
en genindlæsning ikke kan se en halvt omskrevet orden. Bygges som NorRadio
(`app: radio`) og udgives på `latest-norradio`; NorStreams egen radio-fane på
telefonen får det med i næste NorStream-udgave.

### 29. september 2026 — v352: EPG-filen dækker alle sportskanaler

"Ved ikke om det kun er 150 ud af de 22.000 kanaler der er." Det var det: både
panel-kaldene (`refresh`, 150) og filen (`refresh ∩ sport`) stoppede ved 150.
Nu bruger `syncPanelEpg` hele `sportInfo.sport` (alle kanaler der ligner sport,
`looksLikeSport`) for kilden, sorteret efter `rank` (favoritter, favoritternes
lande, resten, skjulte lande sidst), højst `FILE_SPORT_CAP = 2500`. De 150
panel-kald er uændrede. Native `programmes()` kaldes nu per klump af 300
feed-id'er — hver klump er ét gennemløb af filen (streaming, XmlPullParser) og
et JSON-svar på få MB, skrevet i SQLite før den næste læses. Prisen: nogle
flere gennemløb af filen i baggrunden én gang i døgnet; gevinsten: Sport finder
kampe på alle pakkens sportskanaler, ikke kun de 150 første. Programtabellen
bliver større (op mod nogle hundrede tusind rækker); `searchProgrammes` er en
LIKE-scanning, så hold øje med Sport-søgningens svartid i loggen.

### 29. september 2026 — v351: Sport tager alt med igen, men stille

v350 skar Sport ned til favoritter + sport fra egne lande (60). Brugeren vil
have alle 150 med — bare stille. Køen (panelGate) gør det muligt: hvert af de
150 kald venter på, at intet synligt beder om panelet, og mellem kaldene
holdes `BACKGROUND_PAUSE_MS = 1000` ms (forgrund: 150 ms), så hverken panelet
eller boksen mærker det. `runBounded` fik `pauseMs`; baggrundskaldere
(`{ background: true }`) får den lange pause. `SportChannels.api` er fjernet igen.

### 29. september 2026 — v350: én kø til panelet — appen var blevet langsom

Brugeren: "hele appen er begyndt at køre super langsomt og indlæser og
indlæser hele tiden, alt kører meget langsommere end det har gjort."

Først udelukket med beviser: sky-synken (v340) pingponger ikke — `sky_backup`
i Supabase har to rækker, sidst opdateret 28/9 18:08 og 26/9. Så er det ikke
den, der genindlæser alt hvert tiende minut.

Det der ER kommet til siden 338, og som koster: `refreshSportEpg` (v339/v346)
hentede `get_simple_data_table` for op til 150 kanaler — favoritter, så alle
sportskanaler i verden — 30 s efter start og ved hvert Sport-besøg (20 min),
én ad gangen med 150 ms pause, hver med en uges programmer skrevet i SQLite
på JS-tråden. `ensureEpg`/`ensureFullEpg` holdt sig hver til ét kald ad gangen,
men lagene kendte ikke hinanden: Sport i baggrunden + forsiden + guiden +
kanallisten + favorit-forhåndshentning + EPG-filen kunne alle have et kald i
luften mod et panel, der blokerer ved fire (403, se epgCache). Så stod alt og
ventede på panelet.

Rettelsen:

- **`sync/panelGate.ts`**: `withPanel(isBackground, work)` — højst ét panelkald
  i luften i hele appen. To køer: forgrund (det man kan se) går altid før
  baggrund. `ensureEpg`/`ensureFullEpg` tager `{ background: true }` og tager
  køen **per kanal**, så guiden højst venter på ét kald. Baggrund: Sport,
  `prefetchFavouritesEpg`, forsidens I aften-hentning, guidens forhåndshentning
  af hele listen, og EPG-filens download (`native.download`).
- **`SportChannels.api`** (højst `SPORT_API_CAP = 60`): favoritter + sport fra
  favoritternes lande. Kun dem spørges panelet om. `refresh` (150) bruges
  stadig til EPG-filen, så Sky Sports F1 & co. stadig findes — fra filen.
- Sport-hentningen starter 90 s efter start (før 30 s).
- Loggen (v349) får `baggrund:`-linjer: sport-EPG, favoritternes EPG,
  panel-fil, sky-synk — med antal og sekunder. Står appen og indlæser, viser
  Vis loggen hvad der kørte.

Ikke rørt, men værd at vide hvis det stadig er tungt: `sportChannels(db)` er en
LIKE-scanning over alle kanaler (21 ord × 2), kaldt ved sport-hentning (15 min
cache) og i `syncPanelEpg`; forsidens `withNow` er ét `getNowNext` per kort.

### 29. september 2026 — v349: en log i appen, så tv-fejlene kan ses

"Har 348 på nu og alle de fejl jeg nævnte før er stadig gældende, intet af det
virker." v347 og v348 var rettelser ud fra teori, og de ramte ikke. Uden adb
ved sofaen mangler beviser, så appen fører nu selv en lille log i hukommelsen:
`logEvent(tag, tekst)` i `src/diagnostics/log.ts` (300 linjer, `safe` erstatter
alle `http…`-adresser og `password=` — adressen har panelets kodeord).

- **Afspilleren** (`PlayerScreen`): `arkiv: beder om <dialekt>-arkiv fra HH:MM:SS,
  N min (udsendelse …–…, offset …, spol … s)`; `afspiller: klar (arkiv|live)`;
  `buffrer ved N s`; `status: error ved N s`; `fejl/hængt ved N s, forsøg X af Y`;
  `skifter til det andet format`; `opgiver`; og når stykket slutter:
  `strømmen sluttede ved N s → continue|live|done`.
- **Guiden** (`GuideScreen`): `pil venstre/højre i kanten (celle X af Y)`.
- **Indstillinger → avancerede → Vis loggen** viser de sidste 40 linjer, så et
  skærmbillede fortæller hvad der skete. Ny test: `diagnostics/log.test.ts`.

Sådan læses den: fryser start forfra efter ~1 min, se om der står `buffrer`
(panelet stopper med at levere), `status: error` (panelet lukker), eller
`strømmen sluttede` med for få sekunder (arkivet var kortere end bedt om →
`archiveContinuation`). Springer guiden, se om kant-linjen overhovedet skrives.

### 29. september 2026 — v348: bjælken kan nås på tv, og guiden lander på nabo-udsendelsen

Brugeren (tv): "Når opdaterings-pop-up'en kommer frem, kan jeg umuligt komme
hen og trykke opdater." Bjælken (`UpdateBanner`, i App.tsx) ligger uden for
HomeScreens `TVFocusGuideView`, som fanger fokus op/ned/højre — pilene kan
aldrig nå den. Knappen havde `hasTVPreferredFocus={isTV}` fast: den greb
fokus ved hver tegning (procent under hentning) og tabte det ellers.
Nu: `grabFocus` i én tegning 120 ms efter at bjælken kommer frem, og igen når
fasen bliver 'ready' ("Installér nu"). Tilbage = senere som før.

"Hvis jeg trykker tilbage på en udsendelse i EPG springer den 30 minutter
hver gang, men nogle gange springer den en udsendelse over, man gerne vil se,
og kan ikke vælge den." Pil venstre på første celle flyttede vinduet en time og
satte fokus på **samme** udsendelse (`focusTarget.key`); en kort udsendelse
der nu lå til venstre kunne så ligge halvt i kanten og blive sprunget over.
Nu sættes `'<' + key` (venstre) / `'>' + key` (højre), og `GuideRow` regner
`targetIndex` = naboen (findes udsendelsen ikke mere: første/sidste celle).

Start forfra på igangværende udsendelse: meldt "stadig problemer", men tv'et
har efter alt at dømme aldrig fået v347 (sidder på 339, se v341). Afvent test
på en boks med ≥ v347 før der graves videre.

### 28. september 2026 — v347: start forfra på en igangværende udsendelse frøs efter et minut

Brugeren (tv, danske kanaler): "starter godt nok, men stopper efter 1 minut"
— billedet fryser/sort; færdige udsendelser spiller hele vejen. Forskellen:
`playFromStart` bad om `duration = stop − from`, dvs. arkiv **ud i fremtiden**
når udsendelsen stadig sendes. Panelet leverede så en strøm, der frøs.

- `PlayerScreen.playFromStart`: `archiveEnd = min(stop, now − LIVE_EDGE_LAG_MS)`,
  duration derfra (mindst 1 min). Når stykket er spillet (`playToEnd`),
  regner `archiveContinuation` det næste stykke ud — nu også begrænset til
  `now − 90 s` (`minutes`) — og skifter til live, når kanten er nået.
- Test: `archiveContinuation.test.ts` "beder aldrig om arkiv ud i fremtiden".
- Gæld: stall-genforbindelsen går samme vej (`archiveContinuation` → `playFromStart`),
  så et hak midt i fortsætter fra det nåede punkt med et lovligt vindue.

### 28. september 2026 — v346: Sport henter i baggrunden

Brugeren: "Skal den stå og loade sådan hver gang? Kan den ikke gøre det i
baggrunden og gemme i cache?" Listen kom allerede fra databasen (cachen) med
det samme, men status-linjen "Henter programoversigten …" stod ved hver
åbning, til både panel-per-kanal og filen var færdige.

- `HomeScreen`: `refreshSportEpg(session)` 30 s efter start i baggrunden
  (hoejst hvert 20. minut; `ensureFullEpg` springer friske over).
- `SportScreen`: status-linjen vises kun hvis hentningen tager over 0,8 s
  ("Opdaterer programoversigten i baggrunden — listen viser det, der
  allerede er hentet"); listen tegnes uanset.
- `syncPanelEpg`: time-genkørslen udløses kun af kanaler der aldrig har været
  forsøgt (`panel_epg_wanted` = alle nogensinde forsøgte nøgler), ikke af
  at listen "uden programmer" ændrede sig — ellers hentede den filen hver
  time, så længe én favorit ikke fandtes i filen.

### 28. september 2026 — v345: "Test programoversigten" (diagnose i Indstillinger)

Efter v342–v344 stod telefonens GOLD-fil stadig uden EPG, og herfra kan man
ikke se hvilket trin der fejler. `sync/panelEpg.ts: diagnosePanelEpg` koerer
hele vejen for én kilde uden tidsgraenser og svarer med en rapport:

- favoritter fra kilden / uden programmer forude; den foerste med
  normaliseret navn, land og EPG-id;
- panelets svar per kanal (`get_short_epg`) for den foerste;
- filen hentet (sekunder) og antal kanaler i den; parret X af Y;
- op til 6 ikke-parrede med filens kandidater (id og land) eller
  "intet med det navn (taettest: …)";
- programmer fundet for de parrede (skrives ind — testen retter det den kan).

Adresser (med kodeord i stien) filtreres fra fejltekster (`safeText`).
Knappen: Indstillinger → Programoversigt → "Test programoversigten"; bagefter
`onRestored()` saa guiden laeser igen. Naeste skridt: bed brugeren om et
skaermbillede af rapporten og ret efter det.

### 28. september 2026 — v344: `GOLD:`-præfiks foran kanalnavne (kolon, ikke lodret streg)

Brugerens anden fil skriver `GOLD: DR 2 RAW`, `GOLD: DR1 SY…`, `GOLD: DK4 RAW`.
`normaliseChannelName` (`packages/core/src/source/match.ts`) skar kun alt før
en `|` væk, så nøglen blev `GOLDDR2`. Programfilen (`DR2.dk` / "DR2") og
logo-registret kender kun `DR2` → ingen EPG, ingen logoer (skærmbilledet viser
dog logoer — de kommer så fra panelet selv). Rettelse: et præfiks på ét ord
(bogstaver/tal, ≤12) efterfulgt af kolon fjernes også (`COLON_PREFIX`); `TV 2:
Sport` (mellemrum før kolonet) røres ikke. `MATCH_KEY_VERSION` 4 → 5: appen
henter kanalerne igen ved næste start, så `match_key` på hver kanal følger de
nye regler (ellers stod nøglerne efter de gamle). Testet i `match.test.ts`.

Landet for `GOLD:`-kanalerne kommer fra kategorinavnet; kan det ikke udledes,
matcher programfilen kun når navnet er entydigt i hele filen (DR2 er).

### 28. september 2026 — v343: panelets fil for alle favoritter uden EPG, og igen når listen ændrer sig

Brugeren kører en **anden fil** på telefonen og så ingen EPG i guide/kanalliste,
men Sport fandt masser (Premier League, tennis). Det var v342's effekt:
sportskanalerne fik programmer fra panelets XMLTV-fil, favoritterne ikke —
`syncPanelEpg` tog kun favoritter med EPG-id med når `epg_fetch` fandtes (panelet
spurgt per kanal først), og den daglige kørsel (ny nøgle) løb ved start, før
kanallisten var åbnet. Næste chance: om et døgn.

- `wanted` = **alle favoritter uden programmer i de næste 6 t**, uanset EPG-id
  og `epg_fetch` (dem med programmer røres stadig ikke). Plus sportskanalerne
  (v342).
- Kørslen gentages efter **en time** når listen af kanaler at hente for har
  ændret sig (`panel_epg_wanted:<kilde>` = sorterede nøgler), ellers som før
  én gang i døgnet. Aldrig oftere end hver time, heller ikke med "Hent".
- Testene i `panelEpg.test.ts` er rettet til (DR1 med EPG-id uden programmer
  matches nu på id'et).

Hvis brugerens fil er en M3U med egen XMLTV-adresse, går EPG i stedet gennem
`syncXmltv` (tvg-id og navn, én gang i døgnet, loft 40 MB) — det er en anden
vej; panel-filen gælder kun Xtream-kilder.

### 27. september 2026 — v342: Sport finder også UK/US-kampene (panelets fil for sportskanaler)

Brugeren: "Under Sport på telefonen kommer der meget meget mere frem når jeg
vælger Formel 1, der kommer kun 1 frem på tv." Sport søger kun i det der er
hentet, og hvad der hentes var forskelligt:

- `ensureFullEpg`/`get_simple_data_table` virker kun for kanaler med EPG-id
  (13 %, mest danske). Sky Sports F1 & co. har intet — de får programmer
  **alene** fra panelets `xmltv.php` (`sync/panelEpg.ts`), og den blev kun
  læst for favoritter. Telefonen har flere (UK-)favoritter end tv'et → flere
  kampe.
- **Rettelse:** `syncPanelEpg` tager nu også sportskanalerne med
  (`storage/sport.ts: sportChannels().refresh ∩ .sport`, højst 150) — dem
  uden programmer forude, uanset EPG-id. Ny nøgle `last_panel_epg3_ms`, så
  den kører straks efter opdateringen (ved næste synk/start), ikke om et døgn.
  Testet i `panelEpg.test.ts`.
- `SportScreen` venter nu på **begge** hentninger (panel per kanal OG filen:
  `startPanelEpg` ?? `panelEpgInFlight()`) og søger igen bagefter uanset
  udbyttet. Status "Henter programoversigten …" står til begge er færdige.
- **Skjulte lande** udelades ikke længere af Sport (skjult gælder Kanaler,
  ikke søgning — spec sec.5); deres kanaler står bare sidst (`findMatches`
  rangerer +1 000 000). `sportChannels` tager dem med i `sport`-sættet og
  sidst i `refresh`.

Første åbning af Sport efter opdateringen: filen (kan være stor) hentes i
baggrunden i native kode; på langsomt wi-fi kan det tage nogle minutter, før
UK/US-kampene dukker op. Den daglige kørsel holder dem ved lige.

### 27. september 2026 — v341: opdateringen siger hvorfor (Androids svar, én hentning, procent)

Fejlmelding: på tv'et kommer bjælken "Ny udgave klar", installationsskærmen
kommer, brugeren trykker Installér — og appen er stadig den gamle, bjælken
kommer igen. Tjekket herfra: `latest-norstream-tv` har `NorStream-TV.apk`
(107 MB) med versionCode 340, pakke `dk.seomidt.norstream`, og v2-signatur
5E:8F:16:06… (React Native-skabelonens faste debug-nøgle — samme som
telefonens APK og alle CI-builds; `packages/app/android/app/build.gradle`
bruger `signingConfigs.debug` med `debug.keystore` fra skabelonen). Så hverken
fil, versionsnummer eller signatur er forkert. Hvad Android svarede, vidste
appen ikke — det gør den nu.

Ændringer (`features/settings/appUpdate.ts`, `appUpdateParse.ts`, `UpdateBanner.tsx`):
- **Androids svar læses.** Installeren startes med `EXTRA_RETURN_RESULT`, så
  `startActivityAsync` svarer med `resultCode` (−1 OK, 0 afbrudt, 1 fejl) og
  ved fejl `android.intent.extra.INSTALL_RESULT` (PackageManagers
  `INSTALL_FAILED_*`). `installOutcome`/`installFailureText` (testet)
  oversætter: −4 ikke plads, −7/−104 anden signatur, −25 ældre fil,
  −2/−3/−100…−109 beskadiget fil (filen slettes og hentes forfra), −110
  intern fejl, ellers "kode N". Bjælken og Indstillinger viser teksten.
- **"Installeret", men stadig gammel:** 20 s efter et OK-svar ser bjælken
  efter igen; er udgaven stadig den gamle, siger den det ("Genstart enheden").
- **Én hentning per udgave:** filen hedder `norstream-<nr>.apk` i cachen,
  genbruges ved næste forsøg (ingen ny 107 MB), og to hentninger af samme
  udgave bliver til én (`inFlight`). Før skrev to hentninger i den samme fil
  (`file.delete()` + skriv i expo-file-systems `downloadAsync`), og
  installeren kunne få en halv. Størrelsen fra udgivelsen (`assets[].size`)
  tjekkes efter hentningen; en afbrudt hentning sendes aldrig til installeren.
- **Procent i bjælken** (`createDownloadResumable` med fremdrift,
  `onDownloadProgress`), og "NorStream 341 · du har 340", så man kan se hvad
  der kører.
- **Boot-installeren er væk** (`autoUpdate.ts` slettet, kaldet i App.tsx
  fjernet): før startede tv'et ved opstart selv en hentning + Androids
  installer, OG bjælken kom efter 60 s — to veje til den samme fil på én gang.
  Nu henter bjælken på tv af sig selv når den finder en ny udgave (procent i
  knappen), og når filen er hel, står der "Installér nu" med fokus; OK
  starter installeren. Telefonen henter først når man trykker.
- Indstillinger → Opdatering bruger samme vej og viser samme svar/procent.

**Hvis brugeren melder teksten fra bjælken:** −4 → ryd plads på boksen; −7 →
afinstallér og installér forfra (favoritter fra skyen); "installeret, men
stadig udgave N" → noget på boksen blokerer udskiftningen (Play Protect?
en anden bruger/profil på Google TV?) — undersøg med `adb logcat` fra
`PackageInstaller`/`PackageManager` (se ANDROID-TV.md om adb).

### 27. september 2026 — v340: kanalliste i afspilleren, "I aften", sky-synk, "Fordi du så …"

Brugeren afviste sovetimer, PIN og profiler; PiP og flere kanaler er umulige
med én forbindelse. Af de seks forslag valgte brugeren nr. 3, 4, 5 og 6 (nr. 1
"Gem udsendelsen" og nr. 2 "Følg et program" er IKKE bygget — se punkt 10).

**Kanalliste oven på billedet** (`features/player/ChannelOverlay.tsx`):
- Mens man ser en kanal: **pil ned** (tv, når bjælken er skjult) eller knappen
  **Kanaler** i bjælken åbner en liste til venstre over billedet med listen man
  kom fra (ellers favoritterne, højst 120) og "nu og næste" for hver
  (`storage/programmes.ts: nowNextFor` — ét opslag for alle, 6 t frem). OK
  skifter kanal (samme `zapTo` som pilene), Tilbage lukker. Billedet kører
  videre bagved.
- `LandscapePlayer` fik `suspended`: mens listen er fremme røres trykkene ikke,
  bjælken holdes skjult, og fokusfladen fjernes så listen kan få fokus
  (`TVFocusGuideView` fanger fokus i alle retninger; den spillende kanal har
  fokus fra start). `PlayerKey` fik `'up' | 'down'`; pil op henter stadig bjælken.
- Åbnes listen uden en zap-liste (fra en påmindelse fx), bliver favoritterne
  også listen for pil venstre/højre.

**"I aften" på forsiden** (`features/home/tonight.ts`, testet):
- Én udsendelse per favoritkanal (højst 60) i favoritternes rækkefølge: den der
  begynder 19.55–21.15, ellers den længste der sendes i løbet af aftenen (en
  kamp fra 18 tæller). Vinduet er 19.45–22.30; efter 22.15 hedder rækken
  "I morgen aften". OK: sender den → kanalen; ellers påmindelse til/fra (samme
  `ProgrammeCard` som "Dine hold i dag").
- Programoversigten: `storage/programmes.ts: listProgrammesFor` (ét opslag for
  alle kanaler i vinduet); favoritternes hele dag hentes via `ensureFullEpg`
  højst hvert 20. minut (`refreshFavouritesEpg` i FrontScreen).

**Enhederne holdes ens gennem skyen** (`storage/cloudAutoSync.ts`, testet):
- Indstillinger → Gem i skyen → **"Hold dine enheder ens"** (`sky_sync`,
  standard FRA). Samme sky og kodeord som den ugentlige kopi.
- Kører 15 s efter start, når appen kommer frem (AppState), hvert 10. minut,
  20 s efter en ændring (favoritter/logoer-tokens) og 5 s efter man kom tilbage
  fra afspilleren/en film (HomeScreen `runCloud`/`scheduleCloudSync`).
- Regler: **første gang** på en boks: ligger der en *synkroniseret* kopi
  (`synced: true` i JSON, kun lagt op af synkroniseringen) → boksen retter sig
  efter den; ellers lægges boksens eget op. **Den boks man slår det til på
  først bestemmer.** Derefter: skyen nyere end sidst set og intet ændret her →
  hent; ændret her og skyen uændret → læg op; begge → den nyeste vinder
  (skyens `exportedMs` mod `sky_dirty_since_ms`). Fingeraftryk = FNV-1a over
  kopien uden tidspunkt/kodeord (`sky_fp`); `sky_seen_ms` = skyens tidspunkt
  sidst set. En tom kopi lægges aldrig op.
- Hentning: `restoreBackup` med `matchByName` og nyt `mergeProgress` (fremdrift
  i film: nyeste per titel bliver; favoritter, grupper m.m. erstattes). Efter
  "applied" læser HomeScreen favoritter, logoer og indstillinger igen (som
  `onRestored`). Manuelt "Hent" og gendan ved opsætning kalder
  `markCloudApplied`, så det ikke hentes/lægges op igen; opsætning fra skyen
  slår synk til.
- Er synk fra, kører den ugentlige kopi som før (`runWeeklyCloudBackup` ved
  'off').

**"Fordi du så …"** (forsiden, kræver TMDB-nøgle):
- `storage/vod.ts: recentlyWatchedTitles` (nyeste fremdrift; serien for et
  afsnit) → `searchTmdb` → `sync/tmdbHome.ts: recommendedTitles`
  (`/movie|tv/{id}/recommendations`, cachet 6 t via `cachedShelf`
  `because:<nøgle>`). Hver anbefaling slås op i pakken (`findInPanel`, husket i
  appens levetid): dem i pakken først som `Poster` med "I din pakke" (spiller
  direkte), resten som `TitleCard` (bladet med "Se hvor den kan ses").

### 27. september 2026 — v339: "Find kampen" (fanen Sport)

Brugeren godkendte designet ("Ja byg den sådan").

- **Fanen Sport** (`features/sport/SportScreen.tsx`, i menuen under Favoritter;
  tv-søjlens faner er gjort lidt lavere, så otte kan stå udfoldet i 486 pkt).
  Søg på hold, liga eller sport; hver kamp er én række med kanalerne der viser
  den (favoritter først, højst 6). **Kanalerne er knapperne:** OK på en kamp der
  kører skifter til kanalen; på en kommende sætter/fjerner den en påmindelse
  (samme `reminders`-tabel og banner som guiden, 3 min før).
  På tv ligger søgefeltet bag en knap (fast felt over en liste stjæler fokus);
  fjernbetjeningens mikrofon virker i feltet.
- **Reglerne** (`features/sport/sportSearch.ts`, ren TS, testet): tekst uden
  accenter og med ø→o, æ→ae, å→aa ("brondby" finder "Brøndby"); hvert ord skal
  være begyndelsen af et ord i titel/beskrivelse; samme titel + starttid på
  flere kanaler = én kamp; live først, så tid; genudsendelser/højdepunkter
  markeres. Et fund kun i beskrivelsen tæller kun på sportskanaler (ellers
  lignede nyheder kampe).
- **Databasen** (`storage/sport.ts`): `searchProgrammes` forsorterer med LIKE
  hvor vokalerne er jokere (`%br%ndb%`), JS afgør resten. `sportChannels`:
  favoritter + sportskanaler (navn/kategori) fra ikke-skjulte lande, dem fra
  favoritternes lande først, loft 150.
- **Programoversigten:** der søges kun i det der er hentet. `refreshSportEpg`
  (`features/sport/findMatches.ts`) kører `ensureFullEpg` for højst 150 kanaler (`SPORT_CHANNEL_CAP`),
  højst hvert 20. minut (og `ensureFullEpg` springer selv friske over, 6 t).
- **Mine hold** (`sport_teams`, i sikkerhedskopien): ☆/★ ved søgningen. Uden
  søgning viser fanen holdenes kampe de næste 7 dage.
- **Forsiden: "Dine hold i dag"** (efter Fortsæt, før Sidst sete): holdenes
  kampe fra nu til midnat (mindst 6 t frem), uden genudsendelser; kun når der
  er gemte hold (ellers henter forsiden intet). OK: live →
  kanalen; kommende → påmindelse til/fra.
- **Automatisk påmindelse** (`sport_auto_remind`, i sikkerhedskopien): når den
  er slået til, sætter forsiden/fanen en påmindelse for hver kamp i dag på den
  bedste kanal. Appen husker hvilke den selv har sat (`sport_auto_done`), så en
  påmindelse brugeren lukker, ikke kommer igen.

### 27. september 2026 — v338: danske undertekster (OpenSubtitles) + Google TV "Fortsæt med at se"

Brugeren valgte to af idéerne (se "Idéer, 27. sep." nedenfor).

**Danske undertekster fra OpenSubtitles** (film og afsnit):
- `features/vod/openSubtitles.ts` (ren TS, testet): officiel REST-API
  (`api.opensubtitles.com/api/v1`, `Api-Key` + `User-Agent: NorStream v1`).
  `searchUrl` (parametre alfabetisk — ellers omdirigerer de): film på
  `imdb_id`/`tmdb_id`, afsnit på `parent_imdb_id` + `season_number` +
  `episode_number`, ellers `query`+`year`. `rankSubtitles`: menneske- før
  maskine-oversat, så flest hentninger. `downloadSubtitle` (`sub_format: srt`),
  valgfrit `login` (flere hentninger/dag; `base_url` kan være en anden vært).
  `parseSrt` + `cueAt` (binær søgning).
- `externalSubtitles.ts`: IMDb-nummer via `findTitleInfo` (TMDB), afsnit fra
  `listEpisodes`; filer gemmes i `dokumenter/undertekster/<nøgle>-<sprog>-<n>.srt`
  (samme film bruger ikke kvote igen); token fornyes efter 20 t.
  `testOpenSubtitles` (Indstillinger → "Test forbindelsen": The Matrix på dansk).
- **Afspilleren kan IKKE tage undertekster udefra** (expo-video 57 har intet felt
  til det) → `SubtitleOverlay.tsx` tegner selv teksten over videoen,
  `timeUpdateEventInterval` 0,25 s mens den vises.
- `VodPlayerScreen`: 3 s efter "klar" → `externalSubtitleLanguage` (tracks.ts):
  mangler filen et spor på det ønskede sprog (engelsk tæller IKKE), hentes
  det og vises automatisk (filens eget spor slås fra). Undertekst-listen:
  "Dansk (OpenSubtitles)", "Passer den ikke? Prøv en anden", ellers "Hent dansk
  fra OpenSubtitles"/status. Et valgt filspor slår de hentede fra.
- Indstillinger: nøgle, brugernavn, kodeord (`opensubtitles_*`); nøgle og
  brugernavn i sikkerhedskopien, kodeord og token ikke.

**Google TV "Fortsæt med at se"** (kun tv):
- `modules/watch-next` (Kotlin, `androidx.tvprovider:tvprovider:1.0.0`):
  `upsert(json)`/`remove(key)` i Watch Next-kanalen (`TYPE_MOVIE`/
  `TYPE_TV_EPISODE`, `WATCH_NEXT_TYPE_CONTINUE`, position, længde, plakat 2:3,
  `internalProviderId` = titlens nøgle). Fjernet af brugeren (ikke browsable) →
  slettes og lægges ind på ny ved ny afspilning. Manifest: READ/WRITE_EPG_DATA.
- `features/vod/watchNext.ts` (testet): én post per film og per serie; kun når
  man er ≥ 1 min inde og ikke i de sidste 3 min; højst én opdatering pr. minut
  (+ ved afgang); set til ende → fjernes. Link `norstream://vod/<nøgle>?episode=<afsnit>`.
- `app.json` `"scheme": "norstream"`; `App.tsx` lytter på `Linking` →
  `vodDetail` med `autoPlay`, og `VodDetailScreen` afspiller straks (film, eller
  afsnittet) hvor man slap (`moviePlayback`/`episodePlayback`).
- **Uvist:** om Google TV viser Watch Next fra en app uden for Play Store. Er
  rækken tom efter en film, er det Googles valg — intet går i stykker.

### 27. september 2026 — v337: opdaterings-popup mens appen kører

Brugeren: popup'en om en opdatering skal komme "uden at lukke appen ned og uden
at skulle gå i indstillinger". **`features/settings/UpdateBanner.tsx`** (samme
form som `ReminderBanner`): kigger efter en nyere udgave 60 s efter start, ved
hver `AppState` → `active` og hver 30. minut (`checkForUpdate`, GitHubs
udgivelse). Ny udgave → bjælke øverst til højre "Ny udgave klar · NorStream
N" med **Opdater nu** (fokus på tv) → `downloadAndInstall` → Androids
installation. Senere/Tilbage → samme udgave skjult i 6 timer. `quiet` under
`player`/`vodPlayer`/`trailer`: vises først når man er ude af afspilleren.
`maybeAutoUpdate` (tv, ved opstart) er uændret.

### 27. september 2026 — v336: Apple TV først, så IMDb, så YouTube

Brugeren fandt det: tv.apple.com viser trailere uden login (den gamle iTunes-
søgning er lukket, men Apple TV's egen tjeneste "uts" er åben). Brugeren valgte
**Apple først, IMDb som reserve**.

- **`features/vod/appleTrailer.ts`:** `findAppleTrailers(getJson, kind, titler,
  år)` → `tv.apple.com/api/uts/v3/search` (parametrene tv.apple.com selv sender:
  `utscf`, `utsk`, `caller=web`, `sf=143441`, `v=68`, `pfm=web`) → `matchSearch`:
  KUN når titel (normaliseret) og år (±1) passer — søgningen er upræcis ("Dune
  Part Two" gav Zero Dark Thirty) → `/movies/{id}` eller `/shows/{id}` →
  `pickAppleTrailers`: hylde-items med `localizedType: 'Trailer'`, 60–360 s,
  `playables[0].assets.hlsUrl`.
- **Målt** (`scripts/maal/appletv-*.mjs`): trailerne er HLS uden
  kopibeskyttelse, op til 4K; valgt variant 1918x802 H.264 (fuld HD i
  biografformat). Hver kvalitet findes med AAC, AC-3 og E-AC-3 —
  `buildHlsMaster` vælger nu AAC (`mp4a`) før Dolby i samme højde.
- **Dækning:** søgningen finder KUN Apple TV+-titler (Napoleon, Killers of the
  Flower Moon, F1 The Movie, Severance …) plus nogle få. Afprøvet med US, DK
  (da/en), GB og v68/v90 (`scripts/maal/appletv-butik.mjs`): Oppenheimer, Dune:
  Part Two, Gladiator II og Another Round/Druk findes ikke i nogen af dem. Brugeren
  (v336, telefon): "der kommer aldrig trailer fra itunes, imdb hver gang" —
  forventet for panelets film. IMDb er reelt hovedkilden.
- **`sync/tmdb.ts` `findTitleInfo`:** engelsk + original titel, år og IMDb-nummer
  i ét kald (`?language=en-US&append_to_response=external_ids`).
- **`TrailerScreen.start(skip)`:** Apple → IMDb → YouTube (`playNext`). En
  Apple-trailer der fejler under afspilning → `start({apple})` (IMDb/YouTube).
- Ændrer Apple parametrene, svarer søgningen ikke, og IMDb tager over. Ret dem
  i `PARAMS` (se målingerne).

### 26. september 2026 — v335: trailere fra IMDb i 1080p — førstevalg

Brugeren: "kan vi ikke forbedre YouTubes egen afspiller eller bruge en anden
afspiller". Svaret er en anden KILDE: IMDb (Amazon) har de officielle trailere og
udleverer dem som almindelige MP4-filer i op til 1080p til enhver browser —
intet robot-bevis, ingen grænse. Målt (`scripts/maal/imdb-trailer.mjs`): Dune:
Part Two og Oppenheimer i 1080p, hele filen på 1–4 s, alle 200/206. IMDbs
offentlige GraphQL (`api.graphql.imdb.com`, samme som deres hjemmeside) virker;
titelsiderne svarer 202 (AWS-udfordring) — dem bruger vi ikke, og vi prøver
ALDRIG at komme uden om den.

- **Brugeren om v335 på telefonen: "virker det super perfekt nu"** (tv ikke
  prøvet endnu). IMDb er DEN rigtige vej til trailere — prøv altid en anden
  kilde, før man kæmper med YouTubes grænser (v329–v334 var en omvej).
- Apple/iTunes er afprøvet (`scripts/maal/itunes-trailer.mjs`): søgetjenesten
  giver 0 film for alle titler, også i den amerikanske butik — lukket.
- **`sync/tmdb.ts` `findImdbId`:** TMDB-søgning → `/{movie|tv}/{id}/external_ids`
  → `imdb_id`.
- **`features/vod/imdbTrailer.ts`:** `findImdbTrailers(post, tt…)` →
  `primaryVideos`; `pickImdbTrailers`: kun `Trailer`, 60–360 s (Dunes "Final
  Trailer" på 31 s springes over), "Official" først; `pickImdbFile`: MP4 op til
  1080p (ikke HLS).
- **`TrailerScreen.start()`:** på Android IMDb først (`contentType:
  'progressive'`, `imdb: { titleId }`, `id` = IMDbs video-id); ingen IMDb-trailer
  → YouTube-vejen som før (`playNext`). `recoverImdb`: frisk adresse og fortsæt
  fra positionen (adresserne er tidsbegrænsede), ellers YouTube. "Åbn i
  YouTube"-knappen peger på IMDb-siden for IMDb-trailere.

### 26. september 2026 — v334: iPhone-filerne i 720p — rækker grænsen længere?

Brugeren om v333: kører "super godt de første 40–50 sekunder", men ved skiftet
går der ~30 s, og så fortsætter den "i meget dårlig kvalitet" (YouTubes
afspiller på boksen). Hypotese: grænsen er en datamængde, ikke en tid (0:55 på
én trailer, 0:45 på en anden). I 720p er datamængden per sekund ca. det halve.

- `youtubeStream.ts`: `LIMITED_MAX_HEIGHT = 720` for iPhone-klientens direkte
  filer (VR-klienten og HLS stadig op til 1080p).
- `TrailerScreen`: en kort linje i 15 s når den native del slutter før tid:
  `Skift ved m:ss · YouTubes afspiller var klar/var IKKE klar` eller
  `Stop ved m:ss · grænsen blev ikke fundet i tide`. Skiftet (v333) er
  sikkerhedsnet.
- **Næste skridt afhænger af svaret:** når 720p hele vejen, er det løsningen
  (overvej at fjerne linjen). Stopper den stadig ved ~0:50, er grænsen en tid,
  og så er valget mellem blandingen og kun YouTubes afspiller.

### 26. september 2026 — v333: blanding — HD-start native, glat skift til YouTubes afspiller

Diagnoselinjen (v332) på boksen: `IOS filer (kun 1. minut) · 1080p · IPv6
[VR:LOGIN_REQUIRED IOS:ingen-hls]` og `0:55 fejl 403 → webvisning`, som så kørte
til ende. Hjemme hos brugeren: VR-klienten får robot-tjek, iPhone-klienten giver
INGEN HLS, og dens filer stoppes ved ~0:45–0:55. Målt fra GitHub
(`scripts/maal/youtube-besoeg.mjs`): et besøgs-id (visitorData) ændrer intet;
robot-tjekket rammer rigtige filmtrailere (Dune, Oppenheimer), ikke Rick Astley.

**Stoppet: PO-token via BotGuard.** Brugeren valgte først "stort forsøg" (lave
YouTubes bevis selv, som NewPipe/BgUtils). Det er at omgå YouTubes
robot-beskyttelse — det må vi ikke, og værktøjet blokerede det. Intet af det blev
committet. **Byg det ALDRIG.** Brugeren valgte derefter blandingen:

- **`TrailerScreen`:** for de begrænsede filer (`limited`) følger
  `onNativeProgress` afspillerens `bufferedPosition` (timeUpdate hvert 0,5 s).
  Står bufferen stille i 4 s mens der er spillet ≥ 3 s videre (og ikke ved
  slutningen), er YouTubes grænse fundet → `standby`: YouTubes afspiller
  (`measuredEmbedPage(id, tv, startAt, standby=true)`) lægges usynligt
  (`opacity 0`) over videoen med `startAt` = grænsen − 1,5 s; den starter
  lydløst, pauser og melder `standby-ready` efter 3 s. Når positionen når
  `startAt` (eller 403 kommer) → `handOver()`: `window.__go()` (spol, lyd på,
  spil), webvisningen bliver synlig og den native afspiller lukkes. Ikke klar
  endnu → hjulet, og skiftet sker ved `standby-ready`. Fejler YouTubes afspiller
  → almindelig webvisning fra samme sted.
- **Diagnoselinjen er fjernet** (felterne `trace`/`why`/`ipFamily` i
  `youtubeStream.ts` er bevaret til en evt. ny fejlsøgning).

### 26. september 2026 — v332: trailer via iPhone-klientens HLS (ikke dens direkte filer)

**Diagnoselinjen (v331) på brugerens boks viste årsagen:** `IOS · 1080p · IPv6 ·
1:57` og så `0:55 fejl 403 → nye adresser` tre gange, og webvisning. Altså:
VR-klienten virker IKKE hjemme hos brugeren (derfor IOS), og iPhone-klientens
direkte filer afvises ved 0:55 — også med friske adresser. Det er YouTubes
"GVS PO-token"-spærring (yt-dlp: iOS kræver PO-token for https-formater, ikke
for HLS). Fra GitHubs maskine ses spærringen ikke; mål aldrig kun derfra.

- **`youtubeStream.ts`:** hver klient har en `mode`. VR → direkte filer (DASH).
  IOS → `hlsManifestUrl`; `buildHlsMaster` laver et hovedmanifest med KUN den
  bedste H.264-variant ≤ 1080p + dens lydgruppe (undertekst-henvisningen
  fjernes), så den starter i HD. Målt (`scripts/maal/youtube-hls.mjs`): variant
  itag 270 (1920x1080 avc1), lyd-gruppe 234, 38 stykker à ~5 s, alle 200.
  iPhone-klientens direkte filer bruges kun som sidste udvej (`limited: true`),
  og ved 403 går skærmen så straks til webvisningen fra samme sted.
- **`TrailerScreen`:** `prepareStream` skriver `.mpd` eller `.m3u8` og vælger
  `contentType`; diagnoselinjen viser nu fx
  `IOS HLS · 1080p · IPv6 [VR:LOGIN_REQUIRED] · 1:57` — i klammerne står hvad de
  oversprungne klienter svarede.
- **Åbent:** hvorfor VR-klienten fejler hjemme (klammerne viser det næste gang).
  Diagnoselinjen er stadig midlertidig.

### 26. september 2026 — v331: diagnoselinje i traileren + genopretning der ikke giver op

Brugeren om v330: "alle trailere starter super fint hurtigt og super kvalitet,
men stopper stadig efter et minut til halvandet minut". Fast tidspunkt → ikke
tilfældigt. Ukendt årsag (fra GitHub leverer YouTube hele filen, også i tempo).
Mistanke: YouTube tillader kun det første stykke uden "PO-token" på en
hjemmeforbindelse, eller IP-skift (IPv4/IPv6, VPN) — adressen er bundet til `ip=`.

- **Diagnoselinje (MIDLERTIDIG — fjern når årsagen er fundet):** nederst til
  venstre i traileren: klient · kvalitet · IPv4/IPv6 · længde, og for hver
  genopretning `m:ss årsag → resultat` (årsag: `fejl 403`, `stod stille`,
  `sluttede ved …`, `ikke klar`). Kun kategorier og HTTP-kode, aldrig adresser.
  `resolveYoutubeStream` giver nu `client`, `ipFamily` og ved fallback `why`.
- **Genopretning tæller kun forsøg uden fremgang** (`failures`, nulstilles når
  der kom ≥ `NATIVE_PROGRESS_S` = 10 s videre), så en grænse hvert minut bliver
  til korte pauser i stedet for webvisningen.
- For tidlig slutning bruger YouTubes længde, hvis afspilleren ikke kender sin.

### 26. september 2026 — v330: native trailer stoppede før tid — vagt og genopretning

Brugeren om v329: "super billede, super godt, men det stopper desværre inden
trailer er færdig hver gang". Målt (`scripts/maal/youtube-hel.mjs`): YouTube
udleverer hele filen (81 MB, 39 kald, alle 206) — også hentet i afspilningens
tempo over minutter. Rettelser i `TrailerScreen`/`NativeTrailer`:

- **Vagt:** fejl, `loading` i mere end `NATIVE_STALL_MS` (10 s) midt i, eller
  `playToEnd` mere end 3 s før videoens længde → `onBroken(position)`.
- **Genopretning** (`recoverNative`): friske adresser hos YouTube, nyt manifest
  (`trailer-<id>-<forsøg>.mpd`), og der fortsættes fra positionen (`resumeAt`,
  sættes når afspilleren er klar). Højst `NATIVE_MAX_RECOVERIES` (3), så
  webvisningen.
- **Webvisningen som sidste udvej fortsætter fra positionen** (`startAt` →
  `measuredEmbedPage(id, wide, startAt)` spoler dertil i stedet for til 0).
- **Målt i tempo:** 183 s i afspilningens tempo, 30 s foran — hele vejen, alle
  206. YouTube lukker altså ikke adressen undervejs (fra GitHub). Årsagen på
  boksen er ukendt (ingen log i appen); vagten dækker fejl, stå-stille og for
  tidlig slutning uanset årsag. Mulig årsag: adressen er bundet til IP (`ip=`),
  og boksen skifter IPv4/IPv6 eller VPN undervejs.
- **Manifestets længde** er nu den længste af `lengthSeconds` og filernes
  `approxDurationMs` (lengthSeconds er rundet ned; afspilleren stopper ved
  manifestets længde).

### 26. september 2026 — v329: trailer i appens egen afspiller, som Googles butik

Brugeren: Googles tv-butik starter traileren med det samme og i flot HD — "det må
kunne lade sig gøre". Butikken henter YouTubes videofil og spiller den native.
Brugeren valgte selv (AskUserQuestion) den uofficielle vej, velvidende at den kan
holde op med at virke, når YouTube ændrer noget.

- **`features/vod/youtubeStream.ts`**: `resolveYoutubeStream` spørger YouTubes
  app-klienter (`ANDROID_VR`, så `IOS`) via `/youtubei/v1/player` og får direkte
  adresser til video og lyd. `pickFormats` tager H.264 op til 1080p (VP9 kun som
  reserve) + AAC-lyd (originalsproget); `buildMpd` samler dem i et lille statisk
  DASH-manifest med **én** videokvalitet, så den starter i HD. Svar:
  `dash` / `unavailable` (alle klienter siger UNPLAYABLE/ERROR — spærret, fjernet:
  næste kandidat) / `fallback` (bot-tjek, netfejl, intet format: webvisningen).
- **`TrailerScreen`**: på Android prøves hver kandidat først native
  (`NativeTrailer`: expo-video, `contentType: 'dash'`, manifestet skrevet til
  `Paths.cache/trailer-<id>.mpd`, buffer 4 s før start / 30 s frem). Fejl eller
  ikke klar på 15 s → samme video i webvisningen som før (v328). Længde-tjekket
  (teaser under et minut) bruger `videoDetails.lengthSeconds`. På tv lukker
  traileren, når den er slut.
- **Målt** med `scripts/maal/youtube-stroem.mjs` (motor `maal`): ANDROID_VR/IOS
  giver 1080p/4K, filerne svarer 206 på få ms, og de er ligeglade med
  User-Agent (vigtigt: manifestet ligger i en fil, så ExoPlayer sender sin egen).
  GitHubs maskine fik "bekræft at du ikke er en bot" efter første video — det er
  datacenter-IP'en; hjemme er det sjældent, og så tager webvisningen over.
- **Holder det op med at virke:** kør målingen igen og opdatér klient-versionerne
  i `CLIENTS` (samme vej som yt-dlp/NewPipe). Det her er IKKE v324's fejlvej
  (at sende brugeren over i YouTube-appen) — traileren bliver i NorStream.

### 26. september 2026 — v328: trailer bufrer før den starter

Brugeren: "buffer lidt først, så det ikke hakker". `measuredEmbedPage`: traileren
startes lydløst (`mute:1`), pauses så snart den spiller, og YouTube henter videre
imens; når `BUFFER_SECONDS` (15) er hentet (`getVideoLoadedFraction`) — eller
efter `MAX_BUFFER_WAIT_MS` (6 s), så den aldrig hænger — spoles til 0 og spilles
med lyd, og siden sender `playing`, som skjuler appens hjul (hjulet skjules ikke
længere ved `onLoadEnd` for den målte afspiller). v327 blev aldrig udgivet; v328
rummer den (kø + søgning uden nøgle) og v326 (1920-bred side, valg efter opløsning).

### 26. september 2026 — v327: trailer-kø — spærret i DK? så den næste; søgning uden nøgle

v326 (aldrig udgivet) valgte efter opløsning og ramte for "Tuner" en HD-udgave
der er spærret i Danmark ("ikke tilgængelig i dit land"), hvor den gamle virkede.
`TrailerScreen` har nu en **kø af kandidater** (`refill`/`playNext`):
0. alle TMDB-videoer, bedste først (`findTmdbTrailers`/`pickTmdbTrailers`),
1. udbyderens eget bud (længden måles; < 60 s = næste),
2. YouTube Data API hvis der er en nøgle,
3. **YouTubes egen søgning uden nøgle** (`searchYoutubeTrailers` i
   `trailerSearch.ts`: læser `ytInitialData` fra søgesiden, samtykke-cookie
   `SOCS=CAI`; 1–6 min, "trailer" og filmens navn i titlen, ingen
   anmeldelser/reaktioner).
Alle spilles med YouTubes IFrame-API (`measuredEmbedPage`), som melder fejl
(spærret, må ikke indlejres, fjernet) → næste kandidat. Kommer API'et ikke op,
bruges den rene indlejring (kan så ikke melde fejl). Intet kan vises → tv siger
det; telefonen viser YouTubes søgeside.

### 25. september 2026 — v326: trailere i HD (ikke 480p) — rullet ind i v327

Efter v325: "meget bedre, men mange i dårlig kvalitet, ikke HD, meget mindre".
To årsager, begge rettet:
- **Siden var for smal:** YouTubes afspiller vælger kvalitet efter
  afspillerens størrelse i web-punkter. Tv'ets webvisning melder ~930 punkter,
  så den valgte 480p selv i fuld skærm. På tv sættes sidens viewport nu til
  `width=1920` (`viewport(wide)` i `TrailerScreen.tsx`) og `scalesPageToFit`
  skalerer den ned — afspilleren er 1920×1080, og 1080p vælges.
- **TMDB-valget så bort fra opløsningen:** `pickTmdbTrailer` (sync/tmdb.ts)
  vælger nu efter type → **højeste opløsning** (`size`, 1080p+ lige gode) →
  officiel → nyeste. Før vandt en officiel 480p-upload over en 1080p.

### 25. september 2026 — v325: trailere på tv i fuld skærm og HD — INDE i appen

Brugeren: trailerne i Googles butik (stemmesøgning) kører "helt perfekt", og
**traileren skal blive i NorStream**. En v324 der sendte traileren videre til
YouTube-appen blev rullet tilbage før udgivelse (commit "Tilbage: trailere …") —
lav den ALDRIG igen. Googles butik har ingen adgang for andre apps. I stedet,
kun på tv (`TrailerScreen.tsx`):
- **Fuld skærm** (`frameFull`); titel og "Åbn i YouTube" vises kun hvis den ikke
  kan spilles. Tilbage på fjernbetjeningen lukker den.
- **Desktop-Chrome User-Agent** (`DESKTOP_USER_AGENT`) i stedet for mobil:
  YouTubes mobilafspiller vælger lav kvalitet og spiller dårligere på en stor
  skærm; desktop-afspilleren vælger kvalitet efter rammens størrelse.
- Beder om HD (`vq=hd1080`, `setPlaybackQuality`) — uofficielt; YouTube
  bestemmer til sidst. Telefonen er uændret. Ikke bekræftet på boksen endnu.

### 25. september 2026 — v323: serier — direkte til nyeste afsnit

Bruger: med 20 afsnit skal man kunne gå til det sidste og se det. `VodDetailScreen`:
knappen **"▶ Nyeste afsnit S? E?"** ved siden af Fortsæt/Se første (vises når
det nyeste ikke allerede er det den store knap peger på; `latestEpisode` i
`episodes.ts`). Og på tv kan afsnits-nummeret/fluebenet inde i rækken ikke
længere få fokus (`focusable={!isTV}`): to stop per række gjorde 20 afsnit til
40 tryk. Langt tryk på OK på rækken markerer set/ikke set.

**Åbent (start forfra):** efter v322 meldte brugeren at en AFSLUTTET udsendelse
(slut < 1 time før) starter rigtigt, men hopper til live efter ~10 min. Appen
skifter ikke selv til live for en afsluttet udsendelse, så det er formentlig
panelets arkiv for den seneste time, der ikke er færdigt (panelet fortsætter så
med live). Afventer brugerens test af en udsendelse der sluttede > 2-3 timer før.

### 24. september 2026 — v322: start forfra stoppede midt i udsendelsen

Bruger: "Start forfra stopper altid midt i en udsendelse." Årsag: panelets
arkiv leveres som det ligger, NÅR man beder om det. Startes en udsendelse
forfra mens den sendes, slutter strømmen dér hvor man trykkede. Ved
`playToEnd` skiftede vi kun til live hvis udsendelsen stadig blev sendt — ellers
stod billedet stille (og skiftet til live sprang det sendte stykke over). En
genforbindelse (`handleFailure`) genstartede desuden arkivet fra udsendelsens
begyndelse.

Rettelse (`features/player/archiveContinuation.ts` + `PlayerScreen.tsx`): når et
arkiv-stykke slutter før udsendelsen, hentes arkivet igen fra det punkt man nåede
(rundet ned til helt minut + spol resten frem), indtil udsendelsen er set til
ende eller live er indhentet (90 s margin); først dér skiftes til live, og kun
hvis den stadig sendes. To fortsættelser i træk uden fremgang → panelet har ikke
mere. Genforbindelse under start-forfra fortsætter fra punktet i stedet for at
starte forfra. "Fortsæt"-fremdriften gemmes som position i hele udsendelsen.
v322 rummer også v321 (panel-EPG til alle favoritter); v321 blev aldrig udgivet.

### 24. september 2026 — v320: UK/US-EPG fra panelets EGEN xmltv.php, læst native (LÆS DENNE)

Efter v318 stod UK/US uden EPG, mens TiviMate med **kun panelets login**
viste det hele. Forklaring: panelets `get_short_epg` virker kun for kanaler
med EPG-id (13 %, mest danske); resten ligger kun i panelets store
`xmltv.php` (~98 MB), som TiviMate læser og matcher på navn. UK/US-EPG'en vi
havde i v314–v317 kom fra de indbyggede feeds, som frøs boksen.

Løsning, bygget så det IKKE kan fryse boksen igen:
- Native modul `packages/app/modules/panel-epg` (Kotlin, `PanelEpgModule`):
  `download` (til cachen), `channels` (kun kanal-listen; stopper ved første
  `<programme>`), `programmes` (kun ønskede feed-id'er i et vindue). Alt i en
  baggrundstråd med lav prioritet, XmlPullParser bid for bid, aldrig på
  JS-tråden, aldrig hele filen i hukommelsen. Fejltekster uden adresse.
- `src/sync/panelEpg.ts`: **alle favoritter panelet ikke giver EPG for per kanal**
  (v321): dem uden `epg_channel_id`, og dem med id hvor panelet er spurgt
  (`epg_fetch`) men intet gav de næste 6 t — de matches direkte på id'et. Loft 5000,
  vindue −24/+48 t, højst én gang i døgnet (`last_panel_epg2_ms:<kilde>`),
  Hent (force) højst én gang i timen, efter fejl igen om en time. Startes i
  baggrunden fra `syncAllSources` (`startPanelEpg`), som ikke venter på den.
  Modulet registreres i `App.tsx` (`registerPanelEpgNative`), så sync-koden
  kan køre i tests uden React Native.
- `src/sync/panelEpgMatch.ts`: navn **og land** (id-endelse `.uk`/`.us` eller
  landepræfiks). Andet land, generisk navn (> 3 i samme land) eller flertydigt
  uden land → ingen match.
- Indstillinger → Programoversigt: "Hent fra panelets store EPG-fil" (til/fra).
- Kendt begrænsning: kun favoritter. Kanaler uden for favoritterne får stadig
  kun panelets EPG per kanal. En ny UK-favorit får EPG ved næste kørsel
  (i morgen, eller med Hent hvis sidste kørsel er > 1 time gammel).

Kun panelets egen fil — de indbyggede DK/UK/US-feeds kommer IKKE tilbage.

### 23. september 2026 — NorRadio: afspil efter pause = live; listen lander på stationen

Brugeren: (1) tilbage fra en station hoppede listen til toppen — både på
telefonen og i bilen, både i et land og i Mine stationer; (2) efter en pause
(eller når man steg ud af bilen) spillede den den gamle buffer færdig og
hoppede så til live.

- **Buffer:** appens afspil-knap gik allerede til live (`seekToDefaultPosition`),
  men bilen, rattet, Bluetooth og notifikationen trykker afspil direkte på
  afspilleren. Nu får sessionen afspilleren gennem `LivePlayer.kt`
  (ForwardingPlayer): har der været pause (af hvem som helst, også Bluetooth
  der afbrydes), kastes bufferen og der forbindes forfra ved live-kanten. Samme
  efter et opkald (lyden holdt tilbage ≥ 3 s). Modulets `resume` er nu bare `play`.
- **Telefon-listen:** `RememberedList` har fået `frozen` (gemmer ikke rulning
  mens afspilleren ligger ovenpå — Android kunne sætte listen til toppen, og den
  top blev gemt) og `restoreIndex` (lander på stationen der spillede, også efter
  frem/tilbage i afspilleren). Ekstra forsøg efter 300 ms, medmindre brugeren ruller.
- **Bilen (Android Auto):** bilen styrer selv sin rulning; vi har ingen
  "rul hertil". Logsiden (hold på "NorRadio"-titlen) viser nu også
  `abonnerer`/`afmelder` pr. mappe, så man kan se hvad bilen gør ved tilbage.
  Ikke løst endnu — kræver loggen fra en tur i bilen.
- **Udgivelse:** byg-kørsel 428 (run `35845428033`, artefakt `norradio-apk`).
  `udgiv-apk.yml` (variant `norradio`) meldte succes TO gange og satte titlen
  til v219, men `NorRadio.apk` på `latest-norradio` blev IKKE udskiftet (samme
  asset-id 578681329 fra 21. sep). Uafklaret; hent derfor fra artefakten.

### 23. september 2026 — v319: favorit-gen-hægtning må ALDRIG bytte land (LÆS DENNE FØRST)

**Regression fra v310, meldt af brugeren:** efter en synk var favoritterne
pludselig byttet om — danske kanaler erstattet med svenske, UK Sky med tyske.
Rod: v310's `relinkOrphanedFavorites` finder en flyttet favorit igen på det
**rensede navn** (`favorites.match_key`), og `normaliseChannelName` fjerner
landet — `DNK| DR1 HD` og `SWE| DR1` bliver begge `dr1`. Når panelet
omnummererede sine kanaler (nyt `stream_id` → favoritten forældreløs), hægtede
den om til den **første** kanal med det navn efter `sort_order` — uanset land.

Rettelse (skema v24):
- `favorites.country` gemmes på favoritten (backfyldt fra kanalen). `setFavorite`
  og `addCategoryToFavorites` gemmer nu både `match_key` og `country`.
- `relinkOrphanedFavorites` matcher på **kilde + navn + LAND**. Er landet ukendt
  (gammel favorit fra før v24, hvis kanal allerede var væk), gættes ALDRIG på
  tværs: kun hvis navnet er entydigt i kilden (præcis én kanal) hægtes den om;
  ellers står favoritten hellere tom, til den kan hentes fra en sky-backup.
- `restoreBackup` (matchByName, brugt af sky-gendan + onboarding) matcher også på
  **land + navn** — landet udledt af det gemte fulde navns eget præfiks via
  `deriveCountryLoose` — med entydigt navn som reserve. Så lander en
  sky-gendannelse favoritterne på de RIGTIGE lande igen.

**De allerede forkert-byttede favoritter** kan ikke rettes af koden (databasen
har mistet det oprindelige land): de hentes tilbage via **Indstillinger → Hent
fra skyen**. Bemærk faren: en boks med forkerte favoritter må IKKE trykke "Gem i
skyen" før den har hentet ned, ellers overskrives den gode sky-kopi (v311-guarden
fanger kun HELT tomme kopier, ikke forkert-udfyldte). versionCode 319.

### 23. september 2026 — v318: de indbyggede DK-UK-US-EPG-feeds fjernet HELT

**Årsagen til den vedvarende langsomhed** (v316 løste den ikke — brugeren: "kan
overhovedet ikke klikke rundt"). De fem indbyggede standard-feeds (`DK1`, `UK1`,
`SamsungTVPlus/us`, `Plex/us`, `PlutoTV/us`, tidl. `DEFAULT_XMLTV_URLS`) blev
hentet + pakket ud + matchet mod alle kanaler for **hver kilde ved hver synk** —
en tv-boks kunne ikke bære det. Panelet har sin egen EPG.

Rettelse: `DEFAULT_XMLTV_URLS` slettet helt. `maybeXmltv` bruger nu KUN kildens
egen `xmltvUrl`; har en kilde ingen, springes EPG-hentningen over. Brugerens egne
XMLTV-adresser (per kilde, redigeres i Redigér panel/M3U) virker uændret.
`XMLTV_DEFAULTS_VERSION` → 4, så `programmes` + `epg_fetch` + `epg_archive_fetch`
ryddes én gang mere og resterne efter feedsene forsvinder. versionCode 318.
**Brugeren bekræftede: "nu kører det hele dejligt hurtigt igen".** Dvs. hele
XMLTV-sporet (v305/v314/v316) var netto en fejlvej på denne hardware — panelets
egen EPG per kanal er nok.

### 23. september 2026 — v317: Indstillinger gjort mere overskuelig

Brugeren: svært for andre at finde rundt, "alt står bare efter hinanden". Fede
sektionsoverskrifter med skillelinjer, sjældent brugte valg (Streamformat,
Videogengivelse) foldet ind under "Avanceret", trimmede hjælpetekster. Ingen
funktionsændring, kun layout i `SettingsScreen.tsx`.

### 23. september 2026 — v316: loft på XMLTV-matchning + ryd oppustet EPG; panel-udløbsdato

**Vigtig regression fra v314:** den bredere matchning ramte for bredt. Et
generisk navn (`SPORT`, `NEWS`) deles af mange panel-kanaler, og v314 hængte
hvert feed-program på dem ALLE → programtabellen blev gauget op med snesevis af
kopier, og hele appen (især den nu-fyldte guide) blev tung — "10 sek per tryk".

Rettelse (v316):
- `channelIndex` dropper nu navne delt af > 8 kanaler (generiske tokens); ≤ 8 er
  rimelige kvalitets-varianter og beholdes. `MAX_NAME_MATCHES = 8`.
- `XMLTV_DEFAULTS_VERSION` → 3, og ved versionsskift ryddes `programmes` +
  `epg_fetch` + `epg_archive_fetch` ÉN gang (ingen kilde-markering til at fjerne
  netop de oppustede rækker), så tabellen bygges rent op igen.

Desuden (v315, rullet ind i v316): **panel-udløbsdato** under Indstillinger →
kilder. `XtreamClient.getAccountInfo()` læser `exp_date`/`status`; SourcesScreen
viser "Abonnement udløber DD.MM.YYYY (om N dage)" / "ubegrænset" / "udløbet".

### 23. september 2026 — v314: XMLTV-EPG rammer panelets kanaler (bredere matchning)

Bruger: de indbyggede DK+UK+US-EPG-filer "virker ikke" — der kom ingen EPG på
kanalerne fra dem. Rod i `syncXmltv.channelIndex`: når panelet har flere
kvalitets-varianter med samme normaliserede navn (`DNK| DR1 HD`, `DNK| DR1
HEVC`, `DNK| DR1 FHD` → alle `DR1`), blev navnet markeret **flertydigt og
droppet** — og panelet har varianter på næsten alle kanaler, så stort set
intet matchede.

Rettelse: `byName` er nu `navn → LISTE af kanaler`. Et programme hænges på
**alle** kanaler med det navn (samme kanal, samme EPG — det er korrekt for EPG,
i modsætning til logoer hvor et forkert logo er slemt; logoer kræver stadig et
entydigt navn). Desuden matches programmer nu også på feed-kanalens
`<display-name>` (så et ordknudret id som `I2.dr1.dk` med navnet `DR1` også
rammer). `XMLTV_DEFAULTS_VERSION` hævet til 2, så eksisterende installationer
kører XMLTV forfra og henter den brede matchning. versionCode 314.

### 22. september 2026 — v313: pil venstre/højre spoler i film og start-forfra på TV

initialBarShown på LandscapePlayer: på TV starter bjælken skjult i film/arkiv,
så pil venstre/højre spoler med det samme (pil op henter knapperne). Samme omgang
løste også bund-menuen (spol 3 min frem/tilbage) der ikke kunne nås med fokus på
TV — årsag var samme: bjælken lå oven på og fangede fokus.

### 22. september 2026 — v312: trailer i slow-motion på ny boks

Ny Google-streamer viste YouTube-trailere i slowmotion (hakkede mellem hvert
billede) i den indlejrede WebView. Rettelse: `androidLayerType="hardware"` på
`TrailerScreen`'s WebView. Bemærk: kun den ENE boks var ramt, og problemet
"forsvandt af sig selv" senere på boksen — så hardware-laget var sandsynligvis
ikke hele forklaringen, men det gør ingen skade. Film/live var aldrig ramt.

### 22. september 2026 — v311: en tom sky-kopi kan ikke overskrive en god

Ny boks: brugeren skrev sit sky-kodeord i Indstillinger **for at hente**
favoritter ned — men `setSkyCode` slår også den ugentlige kopi til, og
"Gem"/enter lagde straks en **tom** kopi op (boksen har jo intet endnu) og
overskrev den gode kopi i skyen. Favoritterne var så væk begge steder.

Rettelse: `runWeeklyCloudBackup` uploader ikke længere hvis kopien er tom
(`backupHasUserData`: ingen favoritter, grupper, egne logoer, skjulte lande,
seneste-liste eller fremdrift) — returnerer `'empty'`. Kodeordet gemmes stadig,
så man kan trykke **Hent**. Gælder både "Gem nu" og den ugentlige auto-kopi.
CloudBackup-skærmen forklarer det ('empty' → "tryk Hent"). Den lokale
mappe-kopi er urørt (egen fil på egen boks).

### 22. september 2026 — v310: favoritter forsvinder ikke længere når id'er skifter

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

### Åbne punkter (pr. 2. oktober 2026, v364 udgivet på begge mærkater)

- **Start forfra hakker de første minutter på tv'et** (lyd går tilbage,
  billede fryser, stabilt efter ~3 min). Loggen (v362-afsnittet) viser at det
  er frost-vagten (v353) der genforbinder: afspilleren melder "spiller", men
  tiden står stille, to gange ca. 85 s efter stykkets start. Ikke buffering.
  **HLS fejlede også** (brugeren prøvede Streamformat = HLS), så beholderen
  er ikke årsagen. v363 logger `(buffer til N s)` ved frost: buffer langt
  foran = boksens dekoder/lyd-ur (ret: blidt skub i stedet for ny
  forbindelse fra det hele minut); buffer ≈ position = panelet leverer for
  langsomt (ret: større startbuffer på arkiv). **Afventer Vis loggen** fra
  en start forfra med Streamformat = Auto, plus **Test start forfra**.
- **Ny boks uden EPG** (sat op 1. oktober under panelets 404-udfald).
  Panelets EPG-veje svarede 404 fra nginx for alle (målt fra GitHub,
  `scripts/maal/panelveje.mjs`); 2. oktober er 404 væk, men boksen hentede
  stadig ikke. Fundet: den daglige forhåndshentning satte sit døgn-mærke
  selv når alt fejlede (rettet i v364). **Afventer** Vis loggen efter
  opdatering + genstart, og Test programoversigten hvis EPG stadig mangler.
- **Telefonens GOLD-panel har ingen EPG** (v345): Test programoversigten
  fra telefonen er aldrig sendt.
- **DR grøn skærm ved start forfra som HLS** på tv (ældre; derfor .ts).
- Android Auto: rul-til-top i NorRadio (ældre punkt). Apple TV og Google
  Play: se `docs/ANDROID-TV.md` afsnit 7.

### Hvordan det er verificeret

- 743 tests i 79 filer og typecheck grønne i app-pakken; typecheck i
  core og radio. Kør: `cd packages/app && ../../node_modules/.bin/vitest run`
  og `npm run typecheck --workspaces`.
- Alt tv-arbejde er verificeret af brugeren på fjernsynet med fotos; der
  er ingen emulator i kæden. Skærmkomponenterne har ingen enhedstests.
- Udgivelser verificeres på GitHub: udgivelsesnavnet under
  `latest-norstream-tv`/`latest-norstream` skal ende på `(vN)`.

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

1. **Start forfra-frosten:** når loggen med `(buffer til N s)` kommer, vælg
   vejen (se åbne punkter) og byg den. Vokser HLS-arkivet ifølge Test start
   forfra, er v355-planen (ét flow) stadig den rigtige langsigtede vej.
2. **Ny boks:** bekræft at v364 + genstart gav EPG; ellers Test
   programoversigten (v359-linjerne siger adresse/login/kategorier/veje).
3. **Telefonens GOLD-EPG** (v345): få rapporten.
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
10. **Idéer, 27. sep.:** "Find kampen" (v339), kanalliste i afspilleren,
    "I aften", sky-synk og "Fordi du så …" (v340) er bygget. **Ikke bygget
    (foreslået, ikke valgt):** "Gem udsendelsen" (gem fra guiden, se fra
    arkivet senere — række "Gemte udsendelser") og "Følg et program" (nye
    udsendelser af fx Aftenshowet i en række, fra arkivet). **Fravalgt af
    brugeren — foreslå dem ikke igen:** sovetimer ("gider jeg ikke"),
    børnesikring med PIN, profiler. **Umulige med brugerens fil:**
    billede-i-billede og flere kanaler på én skærm — panelet giver kun **1
    samtidig forbindelse**, og preview/afspiller deler den allerede.

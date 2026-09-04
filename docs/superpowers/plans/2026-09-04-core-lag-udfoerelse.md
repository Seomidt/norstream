# SDD ledger - plan: docs/superpowers/plans/2026-09-04-core-lag.md

Branch: feat/core-lag (base 4414cb9)
Spec: docs/superpowers/specs/2026-09-04-uhf-play-design.md (read)

Ruling: feature-branch i stedet for worktree - EnterWorktree kraever eksplicit
bruger/CLAUDE.md-instruktion (findes ikke), og repoet har ingen remote saa
default base-ref origin/<default> ikke kan resolves. Koster intet rework hvis
forkert; fysisk isolation kan tilfoejes bagefter.

## Pre-flight scan

### Par af opgaver der deler fil eller interface

| Fra | Til | Produceret vs. forbrugt | Fund |
|---|---|---|---|
| T1 | T2 | urls.ts + urls.test.ts delt; T1 producerer normaliseBaseUrl, T2 forbruger den | OK - T1 Produces naevner normaliseBaseUrl; T2 siger eksplicit "udvid eksisterende import" |
| T1 | T5 | Programme | OK |
| T1 | T6 | Channel | OK |
| T1 | T7 | Category, Channel | OK |
| T1 | T8 | XtreamCredentials, normaliseBaseUrl | OK |
| T2 | T9 | buildTimeshiftUrl(creds,streamId,start,durationMinutes,dialect,offset?) - T9 kalder med 5 arg | OK - 6. parameter har default |
| T3 | T5 | parseXmltvTimestamp | OK |
| T4 | T5 | decodeXmlEntities | OK |
| T7 | T8 | mapCategories, mapChannels | OK |
| T8 | T9 | FetchLike, FetchLikeResponse | OK |
| T1-T8 | T9 | index.ts re-eksporterer 24 navne | OK - alle 24 verificeret mod definerende opgave |

### Selv-konsistens pr. opgave

| Opgave | Tests vs. kode, filer vs. senere brug | Fund |
|---|---|---|
| T1 | 4 tests mod buildLiveUrl | KONFLIKT - tsconfig types: ["vitest/globals"] (se ruling) |
| T2 | 6 tests; php-URL-forventning mod encodeURIComponent-implementering | OK - encodeURIComponent(':') = %3A matcher forventet streng |
| T3 | 7 tests mod regex | OK - '202609042000 +0000' rammer valgfri sekundgruppe korrekt |
| T4 | 5 tests mod replace-kaede | OK - &amp; sidst er testet eksplicit |
| T5 | 8 tests mod streamet parser | OK - buffer-test: 2.2MB skrevet, drain trimmer til sidste OPEN_TAG, ender ~11 tegn |
| T6 | 9 tests mod parseM3u | OK - 'm3u-1' matcher entries.length=1 ved 2. post |
| T7 | 13 tests mod mapping | OK |
| T8 | 9 tests mod client | OK - endpoint-raekkefoelge matcher forventede URL-strenge |
| T9 | 5 tests mod probe | OK |

Ruling: T1 tsconfig "types" saettes til [] i stedet for ["vitest/globals"].
Testfilerne importerer describe/it/expect eksplicit fra 'vitest', saa globals-
typerne giver nul vaerdi, mens de risikerer at traekke ambient typer ind der
kraever DOM-lib - hvilket ville faa Task 1 Step 10 (tsc --noEmit) til at fejle.
[] haandhaever desuden planens platform-uafhaengighed skarpere. Koster det
rework hvis forkert: implementeren rammer en typefejl og rapporterer den - een
fix-runde.

Note: planens Filstruktur bruger models.ts (fil) hvor spec sec.6 tegner models/
(mappe). Bevidst forenkling for seks typer, ikke en konflikt.

## Fremdrift

Task 1: complete (commits 4414cb9..bfc118f, review clean)
Task 1: minor (deferred): package.json "main" peger paa src/index.ts som foerst
  oprettes i Task 9 - dangling indtil da, ingen effekt (tests importerer relativt)
Task 1: minor (deferred): buildLiveUrl encoder ikke streamId, i modsaetning til
  username/password. Panelet leverer numeriske id'er, saa ingen kendt risiko.
Task 2: complete (commits bfc118f..cbef26a, review clean)
Task 2: minor (deferred): urls.ts:135-146 genberegner encodeURIComponent af
  username/password i begge dialekt-grene; kunne hejses over if'en. Planmandat.
Task 3: complete (commits cbef26a..77dbaa7, review clean)
Task 3: minor (deferred): offset-minuttal bounds-tjekkes ikke; "+0199" accepteres
  som gyldigt i stedet for null. Rigtige XMLTV-feeds udsender ikke dette.
Task 3: minor (deferred): regex tillader offset uden mellemrum ("...000+0200"),
  mere lempeligt end XMLTV-formatet. Udvider kun accept, giver ikke fejlparsning.
Task 4: review 1 - spec FEJL: fromCodePoint kaster RangeError paa kodepunkter
  over 0x10FFFF; bryder global constraint "parsere kaster aldrig".
Task 4: Ruling: fundet opretholdes mod planens egen kode. Spec er bindende
  autoritet og kraever eksplicit at parsing aldrig kaster; spec sec.9 kraever
  desuden at EPG-fejl aldrig blokerer afspilning. Task 5 koerer denne funktion
  paa rigtige feeds. Rettes med range-guard (0..0x10FFFF + isInteger), malformet
  reference lades uroert som ukendte entiteter. Koster intet rework hvis forkert:
  guarden aendrer kun adfaerd for input der i dag crasher.
Task 4: Ruling: planens Step 3-kodeblok i docs/superpowers/plans/2026-09-04-core-lag.md
  indeholder nu kendt defekt kode (fromCodePoint uden range-guard). Planen rettes
  til at matche den faktiske implementering ved afslutning, saa det committede
  dokument ikke lever videre som en fejlkilde for delprojekt 2. Koster intet
  rework hvis forkert; ren dokumentationsrettelse.
Task 4: fix round 1/5 (1 addressed, 0 open - RangeError-guard; commits 0403458..af7fae4)
Task 4: complete (commits 77dbaa7..af7fae4, review clean efter 1 fix-runde)
Task 4: minor (deferred): hex- og decimalgren var naer-duplikater; loest af
  safeCodePointDecode-helper i fix-runden.
Task 5: review 1 - Important (planmandat): MAX_BUFFER-trim koerer een gang per
  write() uden re-tjek; eet stort chunk kan efterlade buffer ~3x over graensen.
Task 5: Ruling: fundet opretholdes. Streaming med afgraenset buffer ER opgavens
  formaal (spec: 10-50MB EPG maa aldrig ligge i hukommelsen paa 2GB TV-boks), og
  docstring lover vilkaarlig chunk-stoerrelse. Reviewer reproducerede konkret.
  Rettes med continue i stedet for return efter trim + test med stort chunk.
  Koster intet rework hvis forkert: continue kan kun stramme graensen.
Task 5: minor (deferred): et legitimt <programme> stoerre end 1MB droppes stille.
  Rigtige EPG-beskrivelser er langt mindre.
Task 5: minor (deferred): attribute() koerer ikke vaerdier gennem decodeXmlEntities,
  hvor childText() goer. Kanal-id og tidsstempler indeholder sajaeldent entiteter.
Note: plan-sync-ruling udvides - baade Task 4's entities-kodeblok og Task 5's
  parser-kodeblok i plandokumentet indeholder nu kendt defekt kode. Begge rettes
  ved afslutning, saa dokumentet ikke lever videre som fejlkilde for delprojekt 2.
Task 5: fix round 1/5 (1 addressed, 0 open - continue efter trim + regressionstest;
  commits aed8574..530bbc1)
Task 5: complete (commits af7fae4..530bbc1, review clean efter 1 fix-runde)
Task 6: complete (commits 530bbc1..0b34509, review clean)
Task 6: minor (deferred): displayName() finder foerste komma i HELE EXTINF-linjen,
  saa group-title="Movies, Drama" fejlparses til vroevl som visningsnavn. Kaster
  ikke, men er en realistisk M3U-form. Vaerd at rette i delprojekt 2.
Task 6: minor (deferred): ingen test af CRLF-linjeskift trods stoette i regex.
Task 6: minor (deferred): ingen test af non-EXTINF-direktiv mellem EXTINF og URL.
Task 7: complete (commits 0b34509..71a157a, review clean)
Task 7: minor (deferred): mapArray-guard slipper array-entries igennem (typeof []
  er 'object'); harmloest da felt-validering fanger dem, men intentionen er utydelig.
Task 7: minor (deferred): archiveDays klampes ikke til ikke-negativ ved malformet
  tv_archive_duration ("-5" giver negativ vaerdi).
Task 8: complete (commits 71a157a..4585ed5, review clean)
Task 8: minor (deferred): client.ts auth-tjek har dead code (auth === undefined
  er redundant, da Number(undefined) !== 1 allerede er true). Planmandat.
Task 8: minor (deferred): Number(auth) !== 1 coercer alt, saa auth: true eller
  auth: [1] ville accepteres. Panel-kontrolleret felt, ikke angriberinput.
Note: planens Step 6 forventer 66 tests i alt; faktisk bliver det 70, fordi
  fix-runderne i Task 4 og 5 tilfoejede 4 regressionstests (3 entities + 1 parser).
Task 9: complete (commits 4585ed5..940a6c3, review clean)
Task 9: minor (deferred): probe-testen "panelet utilgaengeligt" asserterer ikke
  at begge dialekter forsoeges; kun kodelaesning udelukker tidlig abort.
Alle 9 opgaver komplette. 70 tests. Naeste: whole-branch review.

## Whole-branch review (4414cb9..940a6c3)
Fund: 0 Critical, 6 Important, 12 Minor. Verdict "med rettelser".
Tre bekraeftede stille korrektheds-bugs: pdc-start-attributkollision i XMLTV,
komma i M3U-attributvaerdi, og manglende entity-afkodning af attributter der
braekker EPG-til-kanal-joinet.
Task 4: Ruling (bekraeftet af whole-branch review som korrekt).
Task 5: Ruling (bekraeftet af whole-branch review som korrekt).
Ruling: XtreamClient kaster XtreamNetworkError ved ikke-array-svar paa
  listeendpoints. Spec sec.7 lader appen skrive direkte til SQLite og sec.2
  kraever cache-drift; et fejlobjekt der ser ud som tom liste ville overskrive
  god cache med ingenting = datatab i delprojekt 2. mapCategories/mapChannels
  forbliver permissive paa elementniveau. Koster hvis forkert: appen kaster hvor
  den foer stille returnerede tom liste - synligt og let at rulle tilbage.
Ruling: detectTimeshiftDialect faar panelOffsetMinutes OG proever to tidspunkter
  (-1t, derefter -13t). Parameteren alene loeser intet, fordi proben koerer under
  onboarding foer offsettet kendes; -13t daekker hele +/-12t-intervallet, saa en
  tidszonefejl ikke kan faa begge dialekter til at fejle. Koster hvis forkert:
  op til 2 ekstra requests, kun ved onboarding.
Ruling: buildXmltvUrl tilfoejes og eksporteres. Spec sec.6 giver XtreamClient
  ansvaret "EPG", og sec.7 henter fra xmltv.php - men planen udelod det, saa
  delprojekt 2 ville skulle haandrulle credential-encoding der allerede findes
  her. Fire linjer lukker spec-hullet.
Note: planen indsnaevrede spec'en to gange udokumenteret (CatchupWindow udeladt
  fra models; xmltv.php/catch-up udeladt fra XtreamClient). Foerste udeladelse
  er reelt out-of-scope for v1-core; anden rettes via buildXmltvUrl.
Fix-boelge: alle 20 fund ADDRESSED, ingen ny Critical/Important. Klar til merge.
Ruling: to Minor introduceret af fix-boelgen parkeres. (a) anden buffer-test er
  blevet vakuoes efter MAX_BUFFER 1->4MB: kun foerste segment blev skaleret, saa
  eet trim rammer allerede under graensen og loop-grenen testes ikke laengere;
  kommentaren siger desuden ~9MB hvor det er ~3MB. (b) displayName returnerer nu
  tom streng ved ulige antal anfoerselstegn og falder tilbage til tvg-name.
  Begrundelse: skillet har kun een fix-boelge, og runtime-graensen bevises stadig
  af foerste buffer-test - det tabte er regressionsdaekning for eet scenarie.
  Koster hvis forkert: en fremtidig refaktorering af drain() kunne fjerne
  continue-grenen uden at en test faldt. Rettes med eet tal (3_000_000 ->
  5_000_000) plus kommentar.
Ruling: plandokumentet faar en udfoerelses-header i stedet for at faa sine ~8
  kodeblokke omskrevet. Otte omskrivninger risikerer selv at introducere nye
  uoverensstemmelser, og git er den autoritative kilde. Headeren navngiver hvilke
  blokke der er overhalet og hvorfor. Koster intet hvis forkert; ren dokumentation.

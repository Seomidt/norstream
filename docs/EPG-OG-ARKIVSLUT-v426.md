# V426: dato i Se forfra og rigtig filslut i Android-arkivet

## Konkret fejlrapport

Brugeren oplever, at onsdag 28/10 viser samme program som onsdag 21/10, og at en afsluttet udsendelse stopper efter cirka 17 minutter. V425 er den seneste offentlige udgave ved undersøgelsens start; ændringen bygger på commit 16af5a0ce8cae1d1493aee9d6f0831deff70599d.

Den automatiske v425-log fra 28/10 matcher stoppet ved 1039,194 s (17:19). Udsendelsen var planlagt 19:00–19:30 lokal tid. Start forfra blev åbnet 19:52:11, altså cirka 22 minutter efter sluttid. Appen bestilte 45 minutter inklusive slutmargen. Native rapporterede 2705 s, mens bufferen sluttede ved cirka 1039 s. Vagthunden genforbandt fra 19:17 med 19,194 s overlap; brugeren forlod afspilleren, mens det nye stykke stadig ventede på buffer. Dette beviser ikke, hvorfor udbyderen leverede mindre data, eller at en bestemt længere ventetid løser det.

## Native EOF-fejl

V424 tilføjede den bestilte varighed + 5 s som syntetisk SeekMap-varighed, så arkivet kan behandles som en fil og spole i bufferen. Den varighed blev aldrig rettet ved faktisk filslut.

Media3 1.9.0 bruger følgende to betingelser:

- `ProgressiveMediaPeriod.onLoadCompleted` beregner kun varigheden fra de faktiske samples, når varigheden stadig er ukendt.
- `ExoPlayerImplInternal` kræver både afsluttede renderere og en nået/ukendt periodevarighed for at gå i `STATE_ENDED`.

En oplyst varighed på 2705 s kan dermed undertrykke den normale slutmelding, når filen reelt slutter efter 1039 s. Det er en fejl i appens native patch, uanset hvorfor filen blev kort.

V426 bevarer opstartsestimatet, sekventiel TS-læsning, den ene afspiller og byte-0-seek. Extractor-wrapperen registrerer audio/video-samplernes tidsstempler. Kun ved `RESULT_END_OF_INPUT` genudsendes SeekMap med sidste faktisk modtagne sample + 10 ms (samme sidste-sample-margen som Media3). Estimatet bruges således ikke som bevis på, hvor meget indhold der findes. Dermed kan den eksisterende EOF-fortsættelse køre straks fra den bevarede position.

Hvis HTTP-forbindelsen hænger uden at melde EOF, gælder vagthunden og den eksisterende genforbindelse stadig. Rettelsen kan ikke skabe manglende optagelser hos udbyderen. Den angiver heller ikke en garanteret ventetid efter programslut.

Kildekode gennemgået: androidx/media tag 1.9.0, `libraries/exoplayer/src/main/java/androidx/media3/exoplayer/source/ProgressiveMediaPeriod.java` og `libraries/exoplayer/src/main/java/androidx/media3/exoplayer/ExoPlayerImplInternal.java`.

## EPG-dato og baggrundsopdatering

Hele dagen/Se forfra viser fortsat den lokale tabel straks. Ved indgang hentes denne ene kanals fulde plan frisk i baggrunden, også hvis aldersmærket siger under seks timer. Et direkte API-svar bruges direkte på skærmen, så en anden skrivers SQL-data ikke bagefter genindblandes. XMLTV og M3U bevares; kun XML-fallback ved et tomt API-svar tvinges frisk for den ene kanal.

Ved genoptagelse fra standby og tilbagekomst til skærmen opdateres klokken straks. Den kan have stået stille siden onsdag 21/10, og må ikke vente på et minut-tik før onsdag 28/10 vises. Daggrænser, dataejerskab, filtrering og dagvalg bruger samme lokale kalenderdato. En åben side skifter derfor ikke blot navn ved midnat, mens en memoiseret liste beholder gårsdagens programmer. Dagknapperne viser også dato for I dag/I går/I morgen, fx I dag 28.10 over for ons 21.10. Loggen angiver den fulde lokale dato uden programtitler eller streamadresser.

Der flyttes ingen EPG-tider med faste timer eller uger, og genudsendelser afduplikeres ikke efter titel. Hvis udbyderens friske svar selv indeholder en forkert programplan, kan denne klientrettelse ikke bevise den rigtige titel. Der er ikke tilføjet en generel blokering af cachen i resten af guiden.

## Kontrol og afgrænsning

Tests dækker 21/10 over for 28/10, ugeskift på en åben side, frisk API-plan over gammel SQL-plan og EOF-forløbet med de konkrete 1039,194 s fra loggen. Native patch kontrolleres mod den låste expo-video 57.0.3, og et rent Android-build kræves. Den lokale videopakke genskabes fra npm-pakken med integritetskontrol før native tests.

Reglen fra v425, hvor Start forfra kun tilbydes for afsluttede udsendelser, bevares. Live, lyd, film, serier, favoritter, tidszonekorrektioner, slutmargen, den ene streamforbindelse og workflows ændres ikke. APK kontrolleres for versionCode 426, TV-manifest, samme signatur og identisk offentlig digest. Fysisk afspilning på brugerens boks kan ikke verificeres herfra.

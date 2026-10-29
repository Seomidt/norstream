# Start forfra: native TV-dekoder i v381

Fotoet fra 8. oktober kl. 07:43 viser v380: PHP-arkiv fra 06:30,
69 minutter anmodet, faktisk længde 4081,120 sekunder, TS og ét video-/lydspor.
Kilden melder klar og buffering ved 0 sekunder. Der vises ingen senere
native fejl eller registreret urstilstand. Det beviser hverken, at videoen
kører, eller at problemet er løst. Tidligere foto havde buffer til 201 s
ved stop på 110 s; mere buffer alene er derfor ikke en dokumenteret løsning.

## Konkret ændring

Expo-video 57.0.3 tvinger MediaCodec til asynkron køstyring. Den ene
vedvarende PlayerScreen-afspiller på TV vælger nu eksplicit synkron
køstyring med Media3s forceDisableMediaCodecAsynchronousQueueing.
Hardwaredekodning og decoder fallback bevares. Telefon, film-/serieafspiller
og trailerafspiller vælger fortsat upstream-profilen. Live-TV deler samme
TV-afspiller og får derfor også kompatibilitetsprofilen; profilens værdi
skifter aldrig ved overgang mellem live og arkiv eller nyt arkivstykke.
Der oprettes ikke en ekstra afspiller eller streamforbindelse.

Dette er et afgrænset kompatibilitetsforsøg i dekoderens faktiske native
vej, ikke en bevist forklaring på TV2-problemet. Der ændres hverken i
TS-parserflag, serveradresser, styk-/seek-beregninger eller genforsøgstider.
64 MiB bufferloft, kilde-/seek-ventning og bounded retry fra v380 bevares.

## Måling af video, ikke kun lydur

For opt-in-afspilleren udvides native timeUpdate med sikre, nullable
Media3 DecoderCounters: indsendte, viste og tabte videobilleder.
ensureUpdated kaldes før læsning som dokumenteret af Media3. Appen skriver
kun disse tal hvert 30. sekund under aktiv TV-arkivafspilning, med position
og buffer. Manglende/ugyldige tal accepteres ikke. En ny linje begynder
`video-sync v381`. Ingen URL, kodeord eller rå fejltekst logges.

En fremadgående position med uændret `vist` kan nu skelnes fra normal
videofremdrift. Målingerne udløser ikke automatiske genforbindelser; det
ville kræve håndtering af bl.a. surfaces og manglende videobilleder før
man kan bruge dem som pålidelig stopvagt.

## Bygning og verifikation

Install-patchen validerer tre nøjagtige SHA-256 upstream-filer, er idempotent
og stopper ved ukendt native kode. Expo-video bygges stadig fra kildekode,
ikke fra den færdige upstream-AAR. Før udgivelse kræves tests, types,
Android-build, APK-version/signatur og DEX-felter for codec-optionen og
videotællerne. En grøn CI alene er ikke bevis for en korrekt APK.

Ingen fysisk Google TV Streamer eller login til den fejlende TV2-strøm er
tilgængeligt her. Fysisk afprøvning skal derfor fortsat være start forfra
på en igangværende TV2 DK-udsendelse forbi de tidligere 2–5 minutter.

Primære API-kilder:
https://developer.android.com/reference/androidx/media3/exoplayer/DefaultRenderersFactory
https://developer.android.com/reference/androidx/media3/exoplayer/DecoderCounters
https://docs.expo.dev/guides/prebuilt-expo-modules/

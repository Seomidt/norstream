# Start forfra fra v395

Udsendelsen får automatisk 15 minutter efter EPG-sluttiden. Der er intet
slutvalg. Når udsendelse og margen er afspillet, går appen til oversigten.
EPG-tider og programmets identitet ændres ikke. Fremtidige arkivminutter
bestilles fortsat aldrig; sikkerhedsafstanden til live er 90 sekunder.

## Android TV: native kø

Expo-video 57.0.3 bruger Media3 1.9.0. TV-arkiv i TS/PHP får en afgrænset
native kø med højst det nuværende og ét kommende stykke. Live, HLS,
telefonens native betjening og de øvrige platforme bruger deres hidtidige vej.

1. `AnalyticsListener.onLoadCompleted` markerer den aktuelle netværkshentning
   som afsluttet. Bufferpauser og almindelig READY må ikke åbne næste stream.
2. Den endelige varighed i Media3-tidslinjen giver den faktiske arkivslutning.
   Den bestilte minutlængde bruges aldrig som bevis for afspillet indhold.
3. Næste URI starter på det hele minut, der indeholder denne slutning.
   `ClippingMediaSource` med `setAllowUnseekableMedia(true)` trimmer overlap.
4. Kilden sættes i samme ExoPlayers kø, mens tidligere samples stadig spiller.
   Der kaldes hverken `replace`, `pause`, `play` eller nyt `VideoView` ved skiftet.
   Playlist-preload målretter 10 sekunder; TV-rendereren må forvarme dekoderen.
5. Det samme 64 MiB-budget gælder også under preload. Efter en overgang
   fjernes gamle medieelementer og kømetadata. Pauseintention ændres ikke.
6. Native position, bufferposition og intervalhændelser oversættes til ét
   sammenhængende ur relativt til sessionens første arkivminut. Dermed følger
   tidsvisning, gemt position, genforbindelse og fremdriftsvagt samme tidslinje.

Køen nulstilles ved en ny kilde og frigivelse. En generation og oprydning af
handler-callbacks afviser gamle hentninger ved Tilbage, zap og genforsøg.
Hvis varigheden mangler, eller en efterfølger ikke kan forberedes, bevares
det eksisterende EOF/genforsøg fra den faktiske position. En fejlet preload
må ikke afbryde den allerede spillende buffer. To fortsættelser uden ny tid
stoppes. Nær live kan der stadig mangle et færdigt arkivminut.

`arkivkoe v395` logger kun fase, bufferforspring, overlap og overgangsantal.
Ingen URI, credentials, indholdstitler eller native fejltekst sendes her.

## Kontrol

- De normale workspace-tests og typekontrol samt Android/Hermes-eksport.
- Kotlin-controlleren kompileres også separat mod de faktiske Media3 1.9-API'er.
- `node scripts/test-archive-queue.mjs <compiler-mappe>` kompilerer og kører
  den samme controller mod deterministiske Android/Media3-testdobler. Mappen
  skal indeholde Kotlin compiler-embeddable 2.2.0, stdlib, script-runtime,
  daemon-embeddable, compilerens reflect/coroutines-afhængigheder og JetBrains
  annotations. Ingen compiler eller binære afhængigheder committes.
- Native testscenarier: ingen preload før færdig download, PHP/path og kodede
  credentials, reelt minutoverlap, sammenhængende ur, højst to kilder,
  annullering ved Tilbage/zap, ukendt varighed, slutmargen og 60 overgange.
- APK-bygget kontrollerer hele den native bridge mod de virkelige biblioteker.
  Testdoblerne måler ikke hardwaredekoderens eller udbyderens svartid.

På boksen: start en igangværende udsendelse mindst fem minutter efter start,
se over flere arkivgrænser og forbi EPG-slut. Kontrollér lyd/billede, OK-uret,
pause/genoptagelse og Tilbage under afspilning. Sammenhold `koesat` og
`overgang` i de automatiske logs med bufferforspringet. Et positivt forsøg
på én kanal er ikke dokumentation for alle udbyderens kanaler.

## Primære kilder

- [Media3: Playlists](https://developer.android.com/media/media3/exoplayer/playlists)
- [Media3: Preloading](https://developer.android.com/blog/posts/elevating-media-playback-introducing-preloading-with-media3-part-1)
- [Media3: ClippingMediaSource.Builder](https://developer.android.com/reference/androidx/media3/exoplayer/source/ClippingMediaSource.Builder)
- [Media3 1.6: Renderer prewarming](https://android-developers.googleblog.com/2025/03/media3-1-6-0-is-now-available.html)
- [Expo SDK 57: Video](https://docs.expo.dev/versions/v57.0.0/sdk/video/)
- [Kodi: terminerende arkiver og minutgranularitet](https://github.com/xbmc/inputstream.ffmpegdirect)

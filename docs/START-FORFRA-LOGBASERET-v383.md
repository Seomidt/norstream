# Start forfra: buffer og fortsættelse i v383

11. oktober 2026. De automatisk indsamlede v382-rapporter viser to konkrete
forløb i den fælles TV-afspiller. Boksens identitet er ikke nødvendig for
rettelsen.

## Hvad loggen viser

9. oktober kl. 23:15 dansk tid sluttede første arkivstykke ved **2339,946 s**.
Appen bad om næste PHP/TS-stykke fra et helt minut og skulle spole
**59,946 s** ind. Metadata blev læst, men klargøringen udløb i bufferfasen
tre gange. Den sidste native position var 59,946 s, med 18 indsendte og ét
vist videobillede. Det viser et problem efter kildeskift/seek; det beviser
ikke præcis hvilken HTTP-anmodning eller TS-pakke der udløste stilstanden.

10. oktober kl. 06:49 dansk tid standsede bufferen omkring **2527 s**.
Billedtællerne gik frem frem til den tomme buffer. Loggen meldte derefter
buffering flere gange i sekundet uden en registreret genforbindelse.
Den gamle vagt blev nulstillet på READY, og dens anden kontrol krævede
både playing og READY. Statusstøj kunne derfor forhindre begge deadlines.

## Rettelsen

- Et nyt arkivstykke stiler først mod **spoletiden + 5 s** i startup-bufferen,
  højst 90 s. Før kom første READY allerede efter 5 s, selv ved seek til
  næsten 60 s. Det kunne tvinge Media3 ud af de allerede hentede samples
  og over i en ny TS-byteanmodning. Positivt seek kræver stadig metadata,
  READY og en frisk positionsbekræftelse før afspilning. Efter bekræftelse
  sættes minimum for genbuffring tilbage til 5 s. **64 MiB-loftet og
  størrelsesprioriteten gælder også under startup.** Hvis loftet nås før
  hele overlapperen er hentet, kan Media3 stadig have behov for et netværks-seek.
- Lang genoptagelse flytter URL'ens start til det relevante hele minut og
  søger kun sekundresten. Den absolutte programposition bevares: fx
  programstart 20:00:25 + 320 s bliver fra 20:05 med seek 45 s, ikke et
  native seek gennem 345 s gammel fil.
- TV-arkivets stopvagt måler native position med en samlet deadline på
  15 s uden reel fremdrift, kontrolleret hvert 3. s. READY/loading og
  playing-støj ændrer ikke deadlinen. Pause, klargøring af ny kilde og
  afsluttet stykke holder vagten tilbage. Smal urjitter tæller ikke som
  fremdrift. Det bekræftede native ur bruges også under loading, så
  genforbindelse fortsætter fra det faktiske sted.
- Gentagne bufferlinjer begrænses til én per fem sekunder. De eksisterende
  automatiske, private og tidsbegrænsede rapporter fortsætter uden koder.
  Forberedelsesloggen skelner nu første buffer fra buffer efter seek.

Den synkrone TV-dekoder fra v381, én vedvarende native afspiller,
serialiserede kildeskift, to genforsøg og 90 s afstand til live er bevaret.
Ingen provider-adgangsoplysninger eller rå adresser lægges i loggen.
Der ændres ikke i trailers, film, navigation, database eller backend.

## Kontrol og praktisk grænse

Regressionen med 59,946 s reproducerer et seek uden for startup-bufferen
på v382 og består efter rettelsen. Genoptagelse testes for alle 60 sekunder
i et minut. Stopvagten testes efter mere end 40 minutters fremdrift med
READY/loading-oscillation, samt med rigtig pause, korte udfald, urjitter,
ny kilde og urkorrektion. De eksisterende tests for metadata-rækkefølge,
seek-deadline, gammel kilde, tilbage/zap, sidste arkivminut og en hel
igangværende times udsendelse køres også.

Før udgivelse kræves fuld typekontrol og tests, korrekt GitHub-build-commit,
signeret APK med version 383, TV-manifest/banner, faktisk native codec-patch,
videotællere, automatisk fejlfinding og de nye afspillermarkører i Hermes.
Release-assetets digest skal være identisk med den kontrollerede APK.

Ingen fysisk Google TV Streamer eller login til udbyderens TV 2-strøm er
tilgængeligt her. De kontrollerede kodefejl er rettet, men en komplet
udsendelse skal fortsat afprøves på boksen. Et provider-arkiv, der svarer
med HTTP-fejl eller mangler data, kan appen ikke genskabe.

Primære API-kilder: Expo SDK 57 Video-dokumentationen
https://docs.expo.dev/versions/v57.0.0/sdk/video/ (`bufferOptions`, `currentTime`),
Media3s forklaring på seek i indlæste data og TS-buffering
https://developer.android.com/media/media3/exoplayer/troubleshooting,
og den installerede Expo-video 57.0.3-kode i VideoPlayerLoadControl,
DefaultLoadControl og VideoModule.

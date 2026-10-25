# Opdateringshentning og live-log i v417

Brugeren melder fortsatte live-udfald, også efter manuelt valg af HLS.
Ensartet lyd er tidligere afprøvet fra uden bedring. De nyeste tre fotos
viser arkiv-404, ikke en ny live/HLS-fejl. V416 retter et permanent gemt
panelur; denne rettelse er allerede udgivet separat.

## Bekræftet trafikfejl

`UpdateBanner` skjulte tidligere kun sin brugerflade under afspilning.
Opdateringstjekket efter 60 sekunder kunne stadig starte automatisk hentning
af en APK på cirka 107 MB. En allerede startet hentning fortsatte også.
Det kunne optage båndbredde under live, film eller serier.

V417 udsætter automatisk APK-hentning under afspilning og pauser en hentning,
der allerede kører. Den fortsætter efter afspilning. Kontrollen af den
færdige APK og Androids installation bevares.

## Diagnostik og afgrænsning

- Logvisningen viser det faktisk installerede versionsnummer.
- Live-fejlloggen viser også native live-flag og varighed, hvis de kan læses.
  Den indeholder fortsat ingen adresser, kontooplysninger eller rå fejltekst.
- Gennemgangen fandt ingen ny periodisk genåbning af en skjult preview-stream.
  Navigering afventer previewets frigivelse, og fuld afspilning bruger én
  vedvarende native afspiller.
- Med ensartet lyd fra bruges den oprindelige native renderergren. Codec-
  tilstand og HTTP-klient er uændrede siden v399.

Opdateringshentningen er en konkret fejl, men er ikke dokumenteret som årsag
til alle de tidligere EOF’er. Stabiliteten skal kontrolleres på boksen.
En ny live/HLS-log efter et udfald er nødvendig, hvis problemet fortsætter.

## Kontrol

Alle 1.560 tests består: app 1.296, core 260 og radio 4. Typekontrol består
for alle pakker. Downloadtestene dækker pause før start, pause mellem to
microtasks, igangværende hentning, flere pauseejere, fuldførelse samtidig
med pause, genoptagelse med HTTP 206, server der ignorerer Range, deduplikering,
serialisering af forskellige versioner og 45 aktive sekunders stopvagt.
Bannerets tests dækker blandt andet sene svar, afspilningsstart midt i
hentning, unmount, dobbelttryk og skift til en nyere udgivelse.

# v412: Guide og genoptagelse af igangværende arkiv

## Guide

Tilbage fra programgitteret sender native fokus til menuen direkte i
tryk-handleren, før næste rendering eller timer. Fra Hele dagen lukker
første Tilbage dagssiden; næste Tilbage går til menuen. Forsinkede fokusforsøg
fra dagssiden eller programarket annulleres, så de ikke henter fokus tilbage.
Menuen gentager et ubekræftet native fokusforsøg i højst 1,5 sekunder.

## Igangværende arkiv

To fastlåste tilstande er genskabt i regressionstests og rettet:

- Et klargjort arkiv i native `idle` uden `playToEnd` bliver genoptaget fra
  sin faktiske slutposition gennem den eksisterende serialiserede forbindelse.
- Ventning på næste arkivminut opgives ikke alene, fordi native `playing`
  stadig er sand. Reel billed-/positionsfremdrift afgør, om strømmen er
  kommet i gang igen. Sidste billedhændelse kan ligge før native EOF;
  sammenligningen må ikke forveksle det med tilbagespoling.

Pause, baggrund, afmontering og kildeskift stopper genoptagelse. Ved forgrund
kontrolleres arkivets status igen. Ingen parallel live-/arkivforbindelse,
preload, ny codec, ændret tidszone eller tvunget HLS-format er indført.

## Kilder undersøgt 25. oktober 2026

- [Kodi IPTV Simple](https://github.com/kodi-pvr/pvr.iptvsimple), Catchup:
  nogle arkivstrømme terminerer og må genåbnes; minutpræcision kræver afstand
  til live. Det er ikke en måling af brugerens udbyder.
- [Kodi FFmpeg Direct](https://github.com/xbmc/inputstream.ffmpegdirect):
  `catchup_terminates` og `catchup_granularity` beskriver denne model.
- [RFC 8216](https://datatracker.ietf.org/doc/html/rfc8216), 4.3.3.4–5:
  `EXT-X-ENDLIST` afslutter listen; `EVENT` kan få nye segmenter, mens `VOD`
  ikke må ændres. Derfor skal faktisk manifestvækst måles før et formatskift.

## Begrænsninger og afprøvning

Testene bruger native hændelser som mocks, ikke en fysisk Google TV-boks eller
brugerens arkivserver. Fysisk bekræftelse kræver start forfra på en udsendelse,
der stadig sendes, og afspilning over mindst ét arkivskift. Afsluttede udsendelser
skal også kontrolleres. Prøv Tilbage fra både programgitter, programark og
Hele dagen. Der gives ingen garanti for målt svartid på boksen ud fra tests.

Panelets gemte UTC-offset kan blive forældet ved sommertid/vintertid.
Det er ikke ændret uden en historisk korrekt tidszoneløsning, som også
bevarer fungerende afsluttede arkiver.

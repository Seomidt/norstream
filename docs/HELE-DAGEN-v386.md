# v386: programlisten og Tilbage på den rigtige TV-guide

## Fejlene

v385 registrerede Tilbage, men sendte fokusmålet til `GuideRow`, som kun
tegnes på telefonen. Google TV bruger `TimelineGrid` med én fokuserbar
kanalrække. Den nye TV-guide modtog derfor aldrig den gemte kanal.

TV-udgaven af VirtualizedList i react-native-tvos 0.86.2-0 lægger et ekstra,
ustylet TVFocusGuideView omkring ScrollView. `style={{ flex: 1 }}` på
FlatList gælder den indre scrollflade, ikke dette ydre fokuslag. v385's
layoutmodel havde ikke dette lag med og verificerede derfor ikke den
faktiske struktur. Programlisten fik ikke en pålidelig synlig højde.

Desuden ventede dagssiden på hele panelets XMLTV-fil, før kanalens nye,
lille programtabel blev vist. På boksen tog den store fil 138 sekunder.
Et sent cachesvar kunne overskrive nyere data eller data fra en ny kanal.
TimelineGrid lyttede også til venstre/højre, mens dagsoversigten dækkede
den, så valg af arkivdag samtidig flyttede guidens tidsvindue.

## Ændringer

- Dagslisten måler et fleksibelt programfelt og giver sin scrollflade denne
  præcise højde. Det begrænser også TV-listens ekstra lag. Rækker på 76
  punkter og getItemLayout giver et præcist initialScrollIndex ved den
  aktuelle udsendelse, også efter de første 12 rækker. Hver historisk dag
  begynder ved midnat; den ubegrænsede scrollToIndex-retry er fjernet.
- Cache vises straks. Kanalens friske tabel vises før den store XMLTV-fil
  er færdig, og genlæses bagefter. Læserækkefølge og oprydning beskytter
  mod gamle svar; en fejl i filhentningen beholder den eksisterende tabel.
- TV-guiden beholder layout og scrollposition bag dagssiden. Fokus på hele
  baggrunden blokeres native frem for display:none. Tilbage sender den
  gemte kanal til TimelineGrid. Den eksisterende native kanalrække får
  requestTVFocus; målet holdes til onFocus bekræfter det. Forsøgene stopper
  ved bekræftelse, afmontering eller senest efter 1500 ms. Loggen skelner
  mellem bekræftet fokus og manglende bekræftelse.
- Den skjulte guide, programark og afspiller reagerer ikke på tids-pile.
  Et gammelt menuskift annulleres ved Tilbage og når menuen mister fokus.
- Dagsvælgerens foretrukne fokus slippes efter første fokus, så indlæsning
  ikke flytter brugeren tilbage til dagsknappen.

## Verifikation

12 nye tests monterer de faktiske React-komponenter med kontrollerede
native refs og hændelser. De dækker 240/390/428 punkters programfelt,
initial rulning til række 36, dagsskift syv dage tilbage, langsom XMLTV,
forkert svarrækkefølge, kanalskift, netfejl, Tilbage til anden kanal,
pile i den skjulte guide, langsom fokusoverførsel og afgrænset timeout.
Alle 12 fejler mod v385 og består med v386. Timer- og event-oprydning
kontrolleres efter hver afmontering.

Samlet består 1174 tests (922 app, 248 core, 4 radio) og alle workspace-
typekontroller. Android/Hermes-eksport samt APK-version, TV-manifest,
signatur og bundlemarkører kontrolleres før den sædvanlige udgivelse.
Native målinger og fokusmotoren på en fysisk Google TV Streamer er ikke
afprøvet i disse tests. Den eksisterende automatiske logopsamling kan nu
vise dagsprogrammets antal, programfeltets faktiske mål og bekræftet
returfokus uden titler, udbyderadresser eller adgangsoplysninger.

Ingen ændring i start-forfra-afspiller, trailerafspiller eller server.

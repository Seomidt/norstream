# v385: synlige arkivdage og ét niveau tilbage

## Problem og ændring

Dagsrækkens ScrollView havde `flexGrow: 0`, men arvede React Natives
`flexShrink: 1`. Da programlisten kom, fordelte begge scrollflader den
begrænsede skærmhøjde efter deres indhold. Dagsrækken kunne dermed krympe
næsten væk. Dagsrækken har nu `flexShrink: 0` og minimum 48 punkters højde;
programlisten har `flex: 1` og får resten af højden. Kanaloverskriften kan
heller ikke krympe. Dagsrækken har plads til fokusringen, enkel tekstlinje og
14 punkters tekst på TV. Dagsskift starter en historisk dag ved dens begyndelse.
Et TVFocusGuideView holder den vandrette navigation i dagsoversigten.

Tilbage blev allerede behandlet før HomeScreen-menuen, men lukning af
oversigten gendannede ikke fokus i det skjulte guidegitter. Guidens celle
(kanal, cellenøgle og programtid) gemmes nu ved åbning. Efter lukning bruges
det eksisterende fokussignal til denne celle, efter 80 ms så native layout
kan komme frem. Timeren ryddes ved skift eller afmontering. Den almindelige
refokus-timer efter programarket springes over, når arket åbner hele dagen;
den skal ikke konkurrere med dagsvælgeren eller fokusere det skjulte gitter.
Tilbage fra et programark bruger fortsat Modal.onRequestClose til at lukke arket.

## Kontrol

Samme Yoga-kilde som React Native er kørt med et 486 punkters lærred.
En layoutmodel med den gamle opstilling krymper dagsrækken fra 48 til 5
punkter, når 60 programrækker indlæses. Modellen med ændringen holder 48
punkter og 390 punkter til listen. Den er også kontrolleret ved 360 og 524
punkters højde med 0, 12, 60 og 200 programrækker. Det er en layoutmodel,
ikke en kørsel af appen eller fokusmotoren på en fysisk Google TV Streamer.

1162 eksisterende tests, alle workspace-typekontroller og Android/Hermes-
eksport er bestået. React-gennemgangen kontrollerer timeroprydning,
originalt fokusmål, stabile nøgler, temafarver og begrænsede scrollflader.
APK-version, TV-manifest, signatur og rettelsens bundle-markør kontrolleres
før udgivelse. Ingen arkiv-, trailer- eller serverindstillinger ændres.

Dagsrækkens faktiske mål og tilbage-handlingen skrives uden titler eller
adresser i den eksisterende visningslog, så en boks kan verificeres med den
allerede aktiverede automatiske logopsamling.

# Start forfra: friskt serverur i v416

Brugerens fotos fra 25. oktober viser gentagne HTTP 404 ved 0 sekunder,
før arkivets metadata og første buffer. Loggen viser gemt paneloffset på
120 minutter. Det er en anden fejl end de tidligere korte live-EOF.

Appen gemte paneloffset ved forbindelse/kildekontrol og opdaterede det ikke
ved start forfra. Et serverur, der skifter fra sommer- til vintertid, kunne
derfor give en arkivadresse en time ude i fremtiden. Providerens aktuelle
serverur er ikke aflæst fra brugerens boks, så fotos alene beviser ikke,
at det er årsagen til den konkrete 404.

## Ændringen

- En ny start forfra og brugerens eksplicitte “Prøv igen” henter serverens
  egne tidsoplysninger gennem den eksisterende kø for forgrundsopslag.
- Forskellen mellem `time_now` og `timestamp_now` er autoritativ. Et
  IANA-zonenavn bruges kun, hvis runtime kan læse det, og det stemmer med
  den samme måling. Dermed kan en udsendelse fra før et tidsskift bruge sin
  historiske tidsforskel.
- Manglende eller utilgængelige servermetadata bruger senest målte offset
  for netop den kilde. Afviste kontooplysninger behandles som en adgangsfejl.
- Automatisk genforbindelse og næste arkivstykke genbruger det friske ur.
  Der oprettes ingen ekstra afspiller eller arkivprobe.
- Loggen viser nu den faktisk formaterede paneltid uden adresse eller
  kontooplysninger. Sene svar efter Tilbage eller zap kan ikke starte arkivet.

## Kontrol

Samlet 1.527 tests består, fordelt på app 1.263, core 260 og radio 4.
Typekontrol består for alle tre pakker. De nye tests dækker blandt andet
120 → 60 minutter, ældre arkiver fra før tidsskiftet, fast serveroffset,
forkert/understøttelsesløs tidszone, kilder/databaser, metadatafejl, køen,
manuel retry og sen asynkron afslutning efter Tilbage.

Afspilning på brugerens fysiske boks skal fortsat bekræftes efter opdatering.
v416 ændrer hverken live-kildevalg eller live-genforbindelse fra v415.

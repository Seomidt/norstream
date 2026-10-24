# v375 — igangværende TV 2-arkiv og procesafslutning

7. oktober 2026: Brugeren bekræfter, at TV 2 DK startet forfra, mens
udsendelsen stadig sendes, stopper efter cirka fem minutter og lukker helt
ud til Google TV-startskærmen. Afsluttede udsendelser virker. Trailerne i
v374 virker på brugerens boks. Dette er ikke bevis for en bestemt crashårsag.

Arkivbufferens tidsmål er fortsat 90 sekunder, minimum 5 sekunder før start.
Android får nu et byte-budget på 64 MiB og prioriterer størrelse frem for
tidsmålet. Expo Videos installerede Android-load-control ignorerede ellers
størrelsestærsklen under de ønskede 90 sekunder. Budgettet gælder netværkets
mediebuffer, ikke hele appens RAM, dekoder eller en garanti mod nedbrud.
Der hentes fortsat løbende, når afspilningen frigør bufferplads.

Det nye lokale Expo-modul ProcessDiagnostics læser Androids
ApplicationExitInfo på Android 11+ uden ekstra tilladelser. Kun NorStreams
hovedproces: højst otte afslutninger fra de seneste syv dage. Opstarten venter
ikke på aflæsningen; manglende modul, ældre Android eller fejl er ufarlige.
Indstillinger → Fejlfinding viser `proces` med afslutningens tidspunkt,
systemårsag, status og sidst samplede PSS/RSS. En opdatering kaldes ikke et
crash. SIGKILL uden understøttet low-memory-rapportering kaldes kun en mulig
hukommelsesafslutning. Rå beskrivelser, traces, adresser og kodeord læses ikke.
Historikken kommer fra Android og kan derfor aflæses efter proceslukning;
den almindelige afspillerlog er fortsat kun i hukommelsen.

Der ændres ikke på arkivets positionsberegning, 90 sekunders afstand til live,
serialiseret kildeskift, seek-bekræftelse eller trailerudvælgelsen fra v374.
1088 tests og typekontrol på alle pakker bestået. Android/Hermes-eksport og
native TV-build skal også bestå før udgivelse. Den reelle TV 2-arkivstream og
ny diagnostik er endnu ikke afprøvet på den fysiske Google TV Streamer.

Efter installation: prøv en igangværende TV 2-udsendelse i længere end fem
minutter. Ved ny lukning: genåbn NorStream og fotografér `proces`-linjerne i
Fejlfinding. Dermed kan systemets registrerede afslutning bruges i næste
rettelse i stedet for at antage, at alt skyldes buffering.

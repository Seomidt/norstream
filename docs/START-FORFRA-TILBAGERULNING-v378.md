# v378 — afgrænset tilbagerulning af Start forfra

Brugeren vil tilbage til forløbet, hvor en igangværende TV2 DK-udsendelse
spillede korrekt cirka fem minutter før stoppet. Senere rapporteres frosset
billede efter cirka to minutter og lyd, der går tilbage til begyndelsen.
Tidsforskellen er brugerens observation, ikke en kontrolleret A/B-måling.

Sammenligning af v374/v375 med v377 viser, at arkivets URL-, vindues- og
seek-logik ikke er ændret siden den tidligere observation. V375 indførte
64 MiB-bufferbudget. V376 indførte desuden automatisk genforsøg efter
12 sekunders ready/idle uden playing, også uden fejl eller slut-hændelse.

V378 fjerner alene den nye stopvagt fra v376. Den oprindelige kontrol af
frosset afspilningsposition følger igen v375. Ægte kildefejl, buffering og
playToEnd beholder deres eksisterende håndtering. Positionsberegning,
seek-bekræftelse, den ene serialiserede native forbindelse og løbende
buffering bevares. Det er ikke bevist, at den fjernede vagt udløste brugerens
fejl, eller at denne tilbagerulning løser det oprindelige fem-minuttersstop.

Hukommelsesbudgettet bevares: den gamle udgave kunne lukke hele appen.
Den synlige fejl på TV, loggens sikre fejlkategorier, filmnavigationen fra
v377, filmmetadata og de fungerende HD-trailere bevares også.

Kontrol før udgivelse: alle eksisterende tests, workspace-typer,
Android/Hermes-eksport, GitHub-build med præcis commit, APK-version,
TV-manifest/banner og kryptografisk signatur. Den faktiske TV2-strøm og
fjernsynets dekoder er ikke tilgængelige her. Efter installation skal samme
kanal prøves med en igangværende udsendelse i længere end fem minutter.
Ved stop findes loggen under Indstillinger → Avanceret → Streamformat og
videogengivelse → Vis → Vis loggen, uden at lukke appen først.

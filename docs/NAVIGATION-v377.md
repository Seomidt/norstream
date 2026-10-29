# Tilbage fra Serier og Film i v377

Brugeren oplever, at Serier kan åbnes og traileren virker, men at man ikke
kan komme tilbage til Film eller hovedmenuen. En konkret kodefejl er fundet:
HomeScreens Tilbage-behandling omfattede ikke `VodLevel.name = filter`.
Fjernbetjeningens Tilbage gik derfor ikke samme vej som katalogets
brødkrumme. På TV er brødkrummen med vilje ikke fokuserbar, så den kunne
heller ikke bruges som udvej.

Katalogets forældre er nu samlet i `parentVodLevel`, brugt både af
HomeScreen og brødkrummerne. Udvalg går til lande for samme titeltype,
derfra til Film/Serier-forsiden. Titler går til deres kategori og land.
Forsiden har ingen katalog-forælder, så næste Tilbage følger hovedmenuens
eksisterende vej. Fem regressioner dækker Film, Serier og Biograf.

En søgning i det gamle fælles katalogfelt tegnes før katalogets niveau.
Tilbage rydder nu først den søgning, så et niveau-skift ikke skjules bag
den gamle resultatside. Filtervisningen genmonteres ved skift af titeltype,
så films og seriers lokale filtertilstand ikke blandes.

Film-fanen bliver monteret, når den skjules eller en titelside ligger over
den. Dens aktive status sendes nu til filtervisningen. Native filter- og
søgemodaler kan kun være synlige, når kataloget er aktivt, og de lukkes,
når det forlades. Skjult indhold beder ikke om foretrukket filterfokus.

Trailer- og arkivafspilning ændres ikke. TV2 DK's igangværende start-forfra
er fortsat uafklaret og kræver afspilningsloggen fra boksen.

Før normal TV-udgivelse kontrolleres hele testsuiten, workspace-typer,
Android/Hermes-eksport, den faktiske builds commit og APK-version,
TV-manifest/banner og signatur. Fjernbetjeningsforløbet er ikke fysisk
afprøvet på brugerens Google TV Streamer her.

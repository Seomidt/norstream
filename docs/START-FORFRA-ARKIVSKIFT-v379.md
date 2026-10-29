# v379 — rettelse ved skift mellem arkivstykker

7. oktober 2026. Brugerens TV-log viser endelige PHP/TS-stykker, der
slutter ved cirka 120, 154, 179 og 596 sekunder, efterfulgt af en ny
anmodning fra et helt minut med henholdsvis 60, 34, 59 og 56 sekunders
spoling. Den sidste anmodning kl. 19:22:24 har ingen efterfølgende
klarmelding i fotoet. Der er ikke dokumenteret et fast femminuttersloft.
Den viste JVM-afslutning kl. 07:49 er historisk og beviser ikke et crash
under disse afspilninger.

## Dokumenteret kodefejl og rettelse

`PlaybackConnection` satte `currentTime` straks efter `replaceAsync`.
Expo Videos installerede Android-kode afslutter dette promise, når
`prepare()` er kaldt; det afventer hverken nye spor eller færdig buffer.
Spoling kunne dermed ske før den nye kildes tidslinje var klar. En
regressionstest med en afspiller, der ignorerer et for tidligt seek,
fejler på v378 og består efter rettelsen.

V379 afventer både `sourceLoad` for den ønskede kilde og `readyToPlay`,
før spoletiden sættes én gang. Positivt seek kræver fortsat en frisk
positionsbekræftelse før `play()`. Buffering/READY bagefter spoler ikke
igen. Nye kildeskift venter på det forrige native replace-kald, men ikke
på forladte kilders metadata. Pause, Tilbage, zap og Reacts kontrol-mount
afviser sen klargøring.

Indlæsningen har nu sin egen deadline: 30 sekunder for arkiv, 8 for live.
Den gælder også, hvis afspilleren aldrig udsender metadata eller READY.
Native fejl under forberedelsen afviser indlæsningen straks. Skærmen
frigiver `changingSource`, før det eksisterende, afgrænsede genforsøg
håndterer fejlen. Gamle status-timere oprettes ikke samtidig med denne
forberedelse. En kilde opgivet ved timeout kan ikke starte ved sen READY.

Kun en afstand på højst **én millisekund** til et helt minut normaliseres.
119,999 sekunder bliver således det nye minut med 0 sekunders spoling,
frem for det gamle minut med 59,999 sekunders spoling. Fotoets gamle log
afrunder til hele sekunder, så den præcise råtid ved 120 sekunder kendes
ikke. Reelle positioner som 119,750, 154, 179 og 596 bevares; appen antager
ikke, at panelet leverede hele den bestilte varighed, og springer ikke
frem til dens slutminut.

Loggen skriver nu millisekunder ved slutposition/seek, kildens varighed
og antal spor samt forberedelsesfasen ved fejl. Den skriver fortsat ingen
adresser, adgangskoder eller rå native fejlbeskeder.

## Kontrol og praktisk grænse

Regressionskontrollen omfatter alle seks rækkefølger for replace,
metadata og READY, ignoreret TS-seek, pause, annullering, fejl, timeout
uden metadata/READY og nyt forsøg efter timeout. Arkivberegningen prøves
med de konkrete positioner fra TV-loggen og en hel igangværende time.
Før build: **1.126 tests bestået** (874 app, 248 core, 4 radio),
typekontrol på alle pakker og Android/Hermes-eksport bestået. Præcis
GitHub-build-commit og den signerede TV-APK kontrolleres før udgivelse.

Dette retter konkrete appfejl; det beviser ikke, at hele TV2-forløbet nu
er fejlfrit på brugerens Google TV Streamer. Udbyderens stream og den
fysiske dekoder er ikke tilgængelige her. PHP-ruten kan fortsat levere
TS uanset formatvalget; der indføres ikke et HLS-forsøg på denne rute.
Én native afspiller, 64 MiB-mediebudget, 90 sekunders afstand til live,
filmnavigation og de fungerende native HD-trailere bevares.

Efter opdatering: prøv en igangværende TV2 DK-udsendelse i mindst
15 minutter. Hvis det stopper, viser loggen nu, hvilken fase der mangler.
Loggen findes under Indstillinger → Avanceret → Streamformat og
videogengivelse → Vis → Vis loggen.

Primære kilder: Expo SDK 57 Video-dokumentationen,
https://docs.expo.dev/versions/v57.0.0/sdk/video/ (`replaceAsync`,
`sourceLoad`), og de installerede Android-implementeringer i
`expo-video` 57.0.3 (`VideoModule.replaceImpl`,
`VideoPlayer.onTracksChanged` og `onPlaybackStateChanged`).

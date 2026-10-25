# EPG og arkiv: én times korrektion i v418

Brugeren har bekræftet, at v417 stadig viser “19 News” kl. 18 og
“Rivalerne” som igangværende kl. 19, mens uret på boksen passer. Start
forfra åbner også en forkert udsendelse. Brugeren har derfor udtrykkeligt
bedt om at lægge én time til i appen.

## Adfærd ved opdatering

Schema 31 sætter Programtider og Arkivtid til +60 minutter for allerede
tilsluttede Xtream-kilder. Eksisterende egne værdier bevares. Nye kilder,
friske installationer og M3U-kilder starter på 0.

Eksemplet fra billedet bliver dermed:

| Udsendelse | Før | Efter |
| --- | --- | --- |
| 19 News | 18.00–18.30 | 19.00–19.30 |
| Regionalprogram | 18.30–19.00 | 19.30–20.00 |
| Rivalerne | 19.00–19.50 | 20.00–20.50 |

Indstillinger → EPG-tid viser kildevis Programtider og Arkivtid med ±1 time
og nulstilling. Korrektionerne holdes adskilt fra serverens målte tidszone.

## Sammenhængende tidskoordinater

Rå EPG-tider bevares i `programmes`. Læsevisningen `programmes_effective`
anvender kildens korrektion én gang. Det gælder guide, nu/næste, forside,
sport og friskhed. En ny hentning eller genstart lægger ikke endnu en time
til. Varme guideopslag kasseres ved ændret korrektion, også ved sene svar.

Arkivets tilgængelige længde og afspilningsposition beregnes ud fra de
korrigerede programtider. Kun adressens start oversættes efter
`korrigeret tid + arkivkorrektion − EPG-korrektion`. Med begge indstillinger
på +60 åbnes det korrigerede kl. 19. Indstillingerne fastholdes for et
igangværende arkivstykke og dets automatiske genforbindelser.

Arkivhistorik gemmer fortsat rå programidentitet og uændrede positioner;
korrektionen anvendes én gang ved læsning. Begge kildeindstillinger følger
sikkerhedskopien og remappes til den rigtige kilde ved gendannelse.

## Kontrol

Regressionstestene dækker billedets 19 News-eksempel, uændrede rådata,
ny hentning/genstart, døgnskifte, kilde- og databaseadskillelse, opgradering
fra v30, arkivadresse kl. 19, voksende arkiv på 13 frem for 73 minutter,
historik, backup, sene cache-svar og TV-indstillingernes fokus og samtidighed.

Alle 1.619 tests består: app 1.355, core 260 og radio 4. Typekontrol består
for alle tre pakker. SQLite-planen bruger kanalindekset i guiden og tidsindekset
ved oprydning og sportssøgning.

Det faktiske programindhold i providerens arkiv skal fortsat kontrolleres på
boksen efter opdatering. V418 ændrer ingen live-kilder eller native codecs.

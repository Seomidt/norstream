# V423: hurtig guide, automatisk sommer-/vintertid og enklere indstillinger

## Hvorfor

Efter v421–v422 hentede guiden alt forfra ved hvert besøg, én kanal ad gangen gennem panelets ene forbindelse, og viste "Henter programoversigt …" indtil svaret kom. Brugeren havde ikke bedt om at fjerne cachen. Samtidig var vintertid den 25. oktober 2026 forsøgt rettet med faste timer: v418 lagde +60 minutter til EPG og arkiv, og v420 fjernede kun EPG'ens time. Arkivets +60 stod stadig på opgraderede kilder og ville have givet forkert "Start forfra", nu og ved næste skift.

Brugeren bekræftede 26. oktober, at v422 viser de rigtige programtider. Programtiderne bruges derfor uændret fra udbyderen.

## Guiden viser det gemte først

- Tv-guiden, telefonens guide og Hele dagen tegner straks det, der ligger i databasen, og det sidst viste kort huskes mellem besøg.
- Synlige kanaler fornys i baggrunden efter de faste regler i `storage/epgFetch.ts`. Nu/næste fornyes efter 30 minutter og hele tabellen efter 6 timer. Nu/næste hentes for alle synlige kanaler før de fulde tabeller.
- Er der intet gemt, står der "Henter programoversigt …" for netop den række. En fejl vises kun, når der heller intet er gemt.
- Panelets store XMLTV-fil hentes kun for kanaler, hvor API'et svarede tomt, og først efter de små API-svar. Den følger filens egen døgnregel og hentes aldrig tvunget.
- Ét kald ad gangen til panelet bevares.

## Sommer- og vintertid uden håndrettelser

- En hentning fra før et skift mellem sommer- og vintertid regnes altid for gammel bagefter. Reglen bygger på boksens egen tidszone (`crossedTimeChange`).
- I de første tre døgn efter et skift fornyes den fulde tabel hver time i stedet for hver sjette (`nearTimeChange`). Så kommer udbyderens egen rettelse frem uden at nogen rører appen.
- Arkivadressen regnes i panelets målte tidszone for udsendelsens egen dato (`panelOffsetForDate`). Der er ingen fast time oveni.
- Skema 34 sletter alle `epg_shift_minutes:` og `archive_shift_minutes:` én gang. Sikkerhedskopien hverken gemmer eller gendanner dem.
- "Test programoversigten" viser nu panelets ur og zone, boksens ur og panelets tider for den første favorit. En ny time-fejl kan dermed ses i stedet for at blive gættet.

Tests dækker begge skift (25. oktober 2026 og 28. marts 2027) med fast zone, arkiv fra før et skift i begge retninger, opgradering fra skema 31–33 og gendannelse af en gammel kopi.

## Indstillinger

EPG-tid (±1 time pr. kilde) er fjernet. Siden er samlet i ni foldbare grupper, hvor kun én er åben ad gangen:

- Kanaler og kilder
- Guide og programoversigt
- Afspilning og lyd
- Film og serier
- Udseende
- Sikkerhedskopi
- Opdatering
- Fejlfinding
- Konto

Overskriften er en `TvPressable`-række, der beholder fokus, når gruppen foldes ud.

## Ikke verificeret herfra

Hastighed og visning på brugerens fysiske TV og telefon kan ikke måles fra chatten.

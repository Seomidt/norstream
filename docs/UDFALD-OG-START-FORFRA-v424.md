# V424: live-udfald, start forfra og beviser

## Hvad analysen viste (26. oktober 2026)

Fem uafhængige gennemgange af afspilleren, forbindelserne, arkivforløbet, det
native Media3-lag og diagnostikken gav 30 fund, som hver blev efterprøvet af to
agenter. Ingen boks-log fandtes: alle diagnostiksessioner var udløbet og slettet.

**Kanaler der falder ud.** Et rent "slut" (EOF) på en live-TS-strøm kan kun
komme fra panelet eller noget foran det; appens afspiller kan ikke fremkalde det.
Hvorfor panelet lukker, kan loggen ikke bevise: panelets politik, en boks der
kommer bagud, eller en anden forbindelse på samme konto. Appen gjorde det værre:
efter to korte udfald skiftede den permanent til HLS og efter to mere gav den op
med "Streamen kunne ikke afspilles"; med manuelt HLS kom fejlskærmen allerede
efter to udfald, og "Prøv igen" blev hængende på HLS. Under genforbindelse vistes
intet. Telefonen holdt sin forbindelse åben i baggrunden (kun pause), og
forhåndsvisningen åbnede strømme uden at logge. Afkræftet: vagthundene kan ikke
skyde forkert; den daglige synk forklarer ikke gentagne udfald.

**Start forfra fryser.** Panelets stykke slutter 1–2 s før det bestilte hele
minut. Appen rundede ned og bestilte næste stykke med 58 s overlap. Fordi
filens længde skjules for Media3, blev stykket behandlet som live: ingen spoling
i bufferen, genlæsning fra byte 0 med en ekstra forbindelse og 58 s kasseret
ved hvert stykkeskift (10–25 s sort). Sluttede filen før spoletidspunktet, gik
der 30 s i stilhed, to ens genforsøg og ~95 s til fejl. Afkræftet: panelet
leverer det bestilte ±2 s; "arkivkanten halter flere minutter" holdt ikke.

## Rettelser

- `archiveContinuation`: et stykke der slutter op til 5 s før et helt minut
  fortsætter fra minuttet uden spoling. Loggen får `panelet leverede X af N s`
  og `arkivskift tog N s`.
- `PlaybackConnection`: slut under spoling giver straks `ended-before-seek`;
  skærmen venter 15 s og prøver igen uden at bruge genforsøgsbudgettet, højst
  to gange ved samme sekund. `release()` slipper kilden i kø.
- Native (`patch-archive-ts`): den bestilte længde oplyses som varighed, så
  Media3 behandler stykket som en fil (spoling i bufferen, genoptagelse ved
  byte-position, 3 genforsøg). Overlap over 5 s buffres før spoling.
- Live: korte forbindelser giver ikke længere fejlskærm; der genforbindes
  videre med 5 s pause. Ét skift TS→HLS pr. kanalbesøg bevares. "Prøv igen"
  vender tilbage til standardformatet. "Forbinder …" vises under genforbindelse.
  12 s klargøring efter et udfald (4 s buffer). Telefonens frys logges som
  `ur-stoppet`.
- Baggrund: telefon og tv slipper panelets forbindelse ved `background` og
  tager den igen ved `active` (live fra start, arkiv fra positionen).
  "Ret"-proben slipper live, mens den måler.
- `onBack` fra App er stabil, så afspillerens effekter ikke genstarter hver
  time og taber ventende genforsøg.

## Beviser

- Efter et live-EOF slås kontoens `active_cons`/`max_connections` op (ét
  API-kald) og logges: `forbindelser i brug lige efter udfaldet: 1 af 1 – en
  anden enhed holder kontoens forbindelse`.
- Alle kildeskift logges med årsag; genforbindelser der udføres eller springes
  over, og udfald der ignoreres, logges med hvorfor.
- Forhåndsvisning logger åbn/slip/afvist; den daglige synk og panelfilen logger
  start og slut.
- Native tal i hvert `timeUpdate` på alle Android-afspillere: videotællere,
  ufiltreret buffer og netværk (indlæsninger, fejl, sidste kB/ms/HTTP-status,
  Content-Length kendt). Loggen får `net v424: …` ved hvert udfald og ved første
  tik efter.
- Diagnostik: kun rigtige fejlmarkører udløser fejlrapporter; en ny udgave
  åbner et nyt 7-dages vindue (`diagnostic_auto_version`); serveren beholder
  sessioner 14 dage efter udløb, og tilmeldingen er genåbnet i 21 dage.

## Ikke verificeret herfra

Ingen fysisk afprøvning mod brugerens panel eller boks. Den native kode er
kontrolleret mod Media3 1.9's API, men kompileres først i GitHub-bygget.

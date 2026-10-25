# v415: EPG fra cache og enklere filmmenu

## Guiden

Ved hvert besøg begyndte Guide med en tom kanalliste og en hentemarkering,
selv om programmerne allerede lå i SQLite. TV-gitterets lokale læsning
ventede desuden bag det tidligere netværksbatch og læste to ugers data
for hele kanalbufferen, før visningen blev opdateret.

En gyldig kanalliste, favoritgruppe og arkivdialekter genbruges nu synkront
pr. database. SQLite validerer dem i baggrunden. Favorit-/gruppeændringer,
kildeskift, gendannelse og relevante indstillinger invaliderer listen;
et asynkront svar fra før ændringen bliver afvist og genlæst.

TV-gitteret har sin egen afgrænsede hukommelsescache med første live-side
og 12 nylige udsnit. Det synlige 90-minutters vindue læses i ét samlet
SQLite-opslag. Den læsning venter aldrig på netværkskøen. Udbyderens
opdatering skriver fortsat til den vedvarende SQLite-cache med de
eksisterende friskhedsregler og små batches. Historiske udsendelser
læses efter det valgte tidsvindue; syv dages navigation bevares.

Hukommelsescacherne er afgrænset pr. database og slipper ikke data mellem
kilder med samme udbyder-id. Sene og afbrudte svar kan ikke overskrive
en anden kanalvisning eller et andet tidsvindue. Første opstart uden
programdata kræver fortsat en hentning; et genbesøg med cache gør ikke.

## Film og serier

Hovedoversigten har kun Film, Serier og Biograf. Filmsamlinger ligger
øverst inde under Film. Serier jeg følger ligger øverst inde under Serier.
Tilbage fra en filmsamling følger samling → samlinger → Film → oversigt.
Film fra samlinger og genafspilning bruger fortsat de eksisterende
afspilningsveje.

Kendte filmsamlinger viser gemte filmkort først. Lokalt katalogmatch
genbruges, mens kataloget er uændret, og åbning af en kendt samling
starter ingen ny søgning gennem alle film. Nye samlinger findes separat;
netværksopslag holder ikke de gemte samlinger tilbage.

## Start forfra under en igangværende udsendelse

TV-afspilleren kunne miste sin nåede position, hvis den valgfrie native
billedtæller manglede eller konstant var nul. Det kunne enten udløse et
falsk stop under normal afspilning eller genoprette et afsluttet
arkivstykke fra nul, når native-uret samtidig blev nulstillet ved EOF.

En billedtæller bliver nu først autoritativ efter faktisk billedfremdrift.
Uden den bruges en valideret native position; EOF-genopretning bevarer
den seneste accepterede position inden for det anmodede arkivstykke.
En bevidst tilbagespoling nulstiller fortsat uret korrekt. Der åbnes
fortsat kun én medieforbindelse, og genopretningen skifter ikke til live.

Gentagne 30-sekunders EOF-forløb med manglende og nulstillede tællere
er reproduceret i tests. Udbyderens konkrete stream og fysisk TV-afspilning
er ikke observeret fra dette miljø.

## Baggrundsarbejde under afspilning

Hjem kunne starte Sport-EPG efter 90 sekunder, også når en afspiller lå
ovenpå. Baggrundskøen til udbyderen bliver nu sat på pause, mens Hjem
er dækket. Et allerede startet kald kan afsluttes; nye baggrundskald
venter. Forgrundskald kan fortsat gennemføres, og køen genoptages, når
brugeren vender tilbage. De planlagte Sport-/TMDB-jobs og favorit-EPG
efter synk udskydes tilsvarende.
Automatiske opslag af fulgte serier bruger nu også baggrundskøen;
de kunne tidligere gå direkte til udbyderen uden om pausen. Et
annulleret opslag kontrolleres igen, efter det har ventet i kø.

Dette fjerner en konkret konkurrence om udbyderen. Det beviser ikke
årsagen til brugerens DR1-liveudfald; det kræver en frisk native fejl-/
bufferlog fra den berørte boks.

## Gentagne korte live-forløb

De efterfølgende fotologs viste seks live-TS-forløb, som sluttede med EOF
efter cirka 48–78 sekunder med helt tom buffer. Hver genforbindelse stod
igen som forsøg 1. Ti sekunders normal fremdrift havde nulstillet det
almindelige genforsøgsbudget, så det eksisterende HLS-alternativ aldrig
blev afprøvet ved netop dette gentagne mønster.

Live-forløb holder nu særskilt styr på gentagne korte afslutninger pr.
forbindelse. To korte EOF/idle-forløb udløser det eksisterende skift fra
TS til HLS. Samme hændelse kan ikke tælle både som EOF og idle. Flere
minutters stabil fremdrift rydder historikken. Gentagne korte HLS-forløb
stopper med den eksisterende fejlvisning frem for at skifte formater i
en uendelig sløjfe. Pause, kanalskift og arkiv påvirkes ikke.

Dette retter appens manglende eskalering. Loggen alene beviser ikke,
hvorfor den underliggende TS-kilde afsluttes, eller at HLS virker hos
den konkrete udbyder.

## Kontrol

Alle 1.503 tests bestod (app 1.250, core 249, radio 4). Typekontrol
bestod i alle tre workspaces.

Tests omfatter varm genåbning med tilbageholdt database/netværk, skift
mellem databaser, ændringer under en igangværende læsning, første-sides
cache efter rulning, cachegrænser, historiske tidsvinduer, backup og
menuernes faktiske tryk-/Tilbage-vej. SQL-tests bruger rigtig SQLite;
UI/fokus bruger native mocks. Fysisk responstid på brugerens TV er ikke
målt fra dette miljø.

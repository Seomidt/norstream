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

Dette fjerner en konkret konkurrence om udbyderen. Det beviser ikke
årsagen til brugerens DR1-liveudfald; det kræver en frisk native fejl-/
bufferlog fra den berørte boks.

## Kontrol

Alle 1.492 tests bestod (app 1.239, core 249, radio 4). Typekontrol
bestod i alle tre workspaces.

Tests omfatter varm genåbning med tilbageholdt database/netværk, skift
mellem databaser, ændringer under en igangværende læsning, første-sides
cache efter rulning, cachegrænser, historiske tidsvinduer, backup og
menuernes faktiske tryk-/Tilbage-vej. SQL-tests bruger rigtig SQLite;
UI/fokus bruger native mocks. Fysisk responstid på brugerens TV er ikke
målt fra dette miljø.

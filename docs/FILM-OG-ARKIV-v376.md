# Filmfiltre og arkivfejl i v376

## Film

Filtrene er samlet i et panel til højre med én åben sektion ad gangen,
rulbare valg og fast bund. Filmene forbliver synlige bag panelet. Søg søger inden for de valgte filtre
med et tekstfelt, der kun vises på TV, når brugeren beder om det. Tilbage
lukker panelet; alle knapper bruger TV-fokus. Aktive valg kan fjernes
enkeltvis eller ryddes samlet. Nyeste tilføjet og Nyeste udgivelse er
adskilt. År kan vælges enkeltvis for de seneste 17 år, i årtier eller som
intervallet 2020 til indeværende år. Land i pakken er pakkens landgruppe,
ikke en påstand om filmens produktionsland.

Årstallet under plakaten bruger samme prioritet som årsfiltret.

TMDB-resultater accepteres først efter match af titel, originaltitel eller
et bekræftet alias og det angivne år. Filmer og serier søges i hver deres
endepunkt. Forskellige indspilninger uden et årstal afvises som tvetydige.
En plakat er ikke bevis for et match. Et oplyst år fra filmkataloget bruges
også, når filmtitlen ikke selv indeholder årstallet. Sprogangivelser fjernes
ikke længere vilkårligt inde i en rigtig titel.

Valideret genre har forrang. Ved manglende genre bruges filmens egne
udbyderdetaljer. Kategorien bruges ikke som genrebevis for hver eneste
film. Ukendte genrer indgår fortsat i Alle film, men gættes ikke ind i
et bestemt genrefilter. Flere genrer er enten/eller; forskellige
filtertyper kombineres med og.

Skema 28 tilføjer metadata_version efter CREATE og kontrollerer først,
om kolonnen allerede findes. Historiske v24/v25/v26/v27 bevares, og en
færdig v28-genstart skriver ikke skemaet igen. Gamle ukontrollerede genre-,
år- og tjenesteopslag bliver ikke autoritative. De valideres igen i de
begrænsede eksisterende baggrundsbatches. Netfejl bevarer gammel cache,
men mærker den ikke som valideret. UPSERT bevarer tjenestecachen ved samme
TMDB-identitet og rydder den ved et andet match.

OMDb er valgfri under Indstillinger → Ekstra filmdata og kræver egen
API-nøgle. Den udfylder kun manglende genre og år efter opslag på et
IMDb-id fra den validerede TMDB-post. Id, type og kendt år skal stemme.
Den erstatter ikke gode primærdata, og fejl påvirker ikke TMDB-resultatet.
Ingen nøgle er tilføjet eller opfundet. Denne reserve er ikke en løsning
på en helt ukendt film uden et bekræftet id.

## Start forfra

Brugeren oplever stadig stop efter cirka fem minutter på TV2 DK under en
igangværende udsendelse. Appen bliver nu åben med sort skærm; tidligere
lukkede hele appen. Slutårsagen er stadig ikke bevist uden log eller
adgang til brugerens arkivserver.

En konkret UI-fejl er rettet: streamError var kun tegnet i portrætvisning,
så TV-fuldskærm kunne skjule den endelige fejl. Den vises nu permanent med
Prøv igen, som genoptager fra den absolutte arkivposition. Den native
fejltekst vises/logges ikke; kun faste kategorier for dekoder, adgang,
manglende kilde, netværk eller ukendt bruges.

En vagt genkender arkiv, der stopper stille i ready/idle med spillehensigt
og afsluttet seek. Brugerens pause, buffering og kildeskift udløser den
ikke. Efter samme eksisterende tidsgrænse kontrolleres fortsættelsen ved
stykkets slutning; andre stille stop bruger den eksisterende begrænsede
recovery. Én native forbindelse, søgekontrol, TS→HLS ved ignoreret seek og
64 MiB-bufferbudget fra v373/v375 bevares. Trailerkilder ændres ikke.

## Verifikation og begrænsninger

Hele testsuiten (1106 tests), alle workspace-typer og Android/Hermes-eksport kontrolleres
før build. APK-version, TV-manifest/banner, arm64/Hermes og signatur skal
kontrolleres før det sædvanlige udgivelsesworkflow startes.

Der er ingen fysisk Google TV Streamer eller brugerens providerforbindelse
her. UI-fokus og TV2-afspilning over fem minutter skal stadig prøves på
boksen. Ved nyt stop: tag et foto af Indstillinger → Fejlfinding med arkiv-
og afspillerlinjerne; ved procesnedbrud også proceslinjerne efter genstart.
Der loves ikke fuld metadata-dækning eller perfekt afspilning.

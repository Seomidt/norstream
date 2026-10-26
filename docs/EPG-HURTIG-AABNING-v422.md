# V422: lille frisk EPG og ensartede bjælker

## Brugerens billeder

DR1 viser Jordemoderen XV (6:8) 15:15–16:15 i detaljefeltet og en ekstra bjælke med samme titel ved 16:15. Brugeren oplever samtidig lang ventetid på “Henter programoversigt”. Billederne dokumenterer visningen, men indeholder ikke de rå svar fra udbyderen. Den præcise forskel mellem udbyderens korte og fulde API kan derfor ikke bevises herfra.

## Rettelsen

TV-guidens normale åbning henter nu `get_short_epg` med 12 programmer pr. synlig kanal, altid frisk. V421 hentede i stedet hele arkivtabellen ved hvert besøg. Programkort genbruges fortsat ikke mellem besøg.

Hver kanals bjælker tegnes direkte fra dette besøgs eget HTTP-svar. Guiden genlæser ikke den fælles SQL-tabel, hvor andre kaldere kan have skrevet korte API-svar, fulde arkivsvar eller XMLTV med andre tider. En regressionstest reproducerer to forskudte kopier i SQL og bekræfter, at guidens snapshot kun indeholder kopien fra den valgte forespørgsel.

Når brugeren bladrer tilbage eller uden for det korte svars dækningsområde, hentes kanalens fulde tabel én gang under besøget og erstatter hele guidens snapshot for den kanal. Fremadbladning inden for allerede hentet dækning udløser ingen netværkshentning. Når korte programmer udløber under et længere besøg, kan det næste tidsvindue hente en ny kort oversigt.

Rækker vises løbende. En eventuel stor XMLTV-fil hentes først efter de øvrige synlige kanalers små API-svar, så en kanal uden API-EPG ikke blokerer resten af den første side. XMLTV-fallback og M3U bevares. Både HTTP og SQL er fortsat serialiseret; der oprettes ingen parallel afspiller eller ekstra streamforbindelse.

Programmernes ydre beholdere bruger nu præcise procentbredder fra deres varighed. Padding og mellemrum ligger inden i beholderen og kan ikke længere forskyde tidsaksen forskelligt fra række til række. En udsendelse på 60 minutter fylder præcis 60/90 af det synlige 90-minuttersvindue, og original start/slut bevares til detaljefelt og OK-handling.

## Afgrænsning og kontrol

Kun TV-guide, EPG-svarets valgfri callback, tests, versionCode og dette dokument ændres. Afspiller, native kode, film, serier, favoritter, indstillinger, tidsforskydninger og workflows røres ikke. Der indføres ingen ny timekorrektion eller titelbaseret sammensmeltning af lovlige genudsendelser.

Regressioner dækker den fotograferede 15:15–16:15-udsendelse som én bjælke, procentbredder, samme objekt til detaljefelt og OK, ingen blanding med SQL, kort åbning uden fuld arkivtabel, direkte historisk åbning, fremadbladning uden netværk, forsinkede/skjulte kald, genindgang, forgrund, M3U, XMLTV og langsom fil uden blokering af næste API-kanal. Hele testsuiten og typekontrol køres før build. APK verificeres for versionCode 422, TV-manifest, samme signatur og identisk offentlig digest. Hastighed og visning på brugerens fysiske TV kan ikke måles herfra.

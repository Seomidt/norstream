# V421: frisk EPG ved hvert guidebesøg

Brugeren bad 26. oktober 2026 om at fjerne EPG-cacheadfærden. Kun EPG ændres. V420 havde stadig v400's modulglobale lastProgMap og seks timers aldersregel for den fulde oversigt. Det nye vedhæftede foto viser igen 07:15 og dokumenterer ikke appversionen; billedet bruges derfor ikke som bevis for en bestemt installeret versions fejl.

## Frisk data i guiden

Programkort gemmes ikke længere på tværs af guidebesøg. Åbning af guiden og tilbagekomst fra baggrund starter en frisk fuld EPG-hentning for de synlige kanaler. Den går uden om 30-minutters- og seks-timers-markeringerne. Hver kanal hentes én gang under besøget; pilene læser derefter det valgte tidsvindue fra den netop hentede tabel. TV læser kun de synlige 90 minutter.

Gamle rækker vises ikke som aktuelle før den friske hentning er lykkedes. Hentning og fejl har tydelig status. Gamle SQL- og netværkssvar kan ikke genindsætte et programkort efter ny indgang, kilde-/gruppeskift eller skift af tidsvindue. M3U bruger den importerede oversigt, fordi en M3U-kilde ikke har panelets EPG-API.

TV-forælderen kører ikke samtidig telefonens EPG-hentning. Forhåndshentning af alle favoritters fulde API-tabel er fjernet. Afbrudte køkald kontrolleres inde i panelkøen, før HTTP starter, og giver hverken fejl eller en falsk hentemarkering. Der oprettes ingen ekstra afspiller.

## Sammenhængende oversigt

Friske fulde API-svar erstatter hele den pågældende kanals afledte programtabel atomisk, også et vellykket tomt svar. Et mislykket HTTP-kald sletter ikke data. EPG-skrivere er serialiseret pr. database, så to svar ikke kan flette deres sletning og indsættelse. Favoritter, arkivpositioner og filmdata røres ikke.

Hvis API'et mangler en kilde, som kun har UK/US-programmer i XMLTV, hentes en frisk kildefil højst én gang pr. kilde under det aktuelle guidebesøg. Kun endnu ikke opfriskede kanalers EPG erstattes. Den friske tabel må bruges ved rulning under samme besøg, men der gemmes ikke et programkort til næste besøg. Dagsoversigten har samme friske, kanalafgrænsede XMLTV-fallback.

Ved overlappende data følger gitterets placering, nu-markering og OK-valg den seneste start, som nu/naeste-opslaget. En lang udsendelse kan opdeles visuelt omkring et kort overlap uden at ændre dens originale Programme-objekt eller tidsstempler. Dagsoversigten markerer kun ét program som aktuelt. Ingen ekstra timeforskydning indføres.

## Afgrænsning og validering

Afspiller, native patches, lyd, film, serier, covers, samlinger, fulgte serier og brugerens favoritter bevares. De almindelige kald uden for guiden beholder deres eksisterende aldersregler; den synlige guide bruger eksplicit frisk hentning. SQLite bevares som fælles tabel for arkiv og programopslag, men dens tidligere hentetid kan ikke blokere en ny guideindgang.

Regressioner omfatter genindgang uden gammelt kort, frisk hentning trods nylig markering, sen SQL efter vindues-/sessionsskift, annulleret køkald, begrænsning til synlige API-kanaler, tomt svar kontra HTTP-fejl, atomisk udskiftning, XMLTV-fallback og den viste DR2-overlapgeometri. APK kontrolleres for version 421, TV-manifest, samme signatur og identisk digest i den offentlige udgivelse. Fysisk afspilning på brugerens TV kan ikke verificeres herfra.

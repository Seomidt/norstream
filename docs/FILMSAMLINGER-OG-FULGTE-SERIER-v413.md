# v413: Filmsamlinger og serier, man følger

## Betjening

Under Film findes **Filmsamlinger** og **Serier jeg følger**. Sidstnævnte
findes også øverst under Serier. Fra en film med en kendt samling åbner
**Se samlingen** den samme oversigt. Tilbage følger katalogets niveauer.
Menuens fem genveje fordeles på rækker efter lærredets bredde.

Samlinger viser kun film i boksens eget katalog, i udgivelsesrækkefølge.
Match kræver samme TMDB-id eller entydig titel/originaltitel og årstal.
HD-/4K-udgaver af samme film giver ét kort. Metadata gemmes lokalt; der
findes højst 24 nye katalogtitler per besøg, og **Find flere samlinger**
fortsætter. En åbnet film prioriterer sit eget opslag. Samlinger opbygges
derfor gradvist første gang og kræver den eksisterende TMDB-nøgle.

På seriesiden vælges **Følg serien**. Eksisterende afsnit bliver udgangspunktet.
Nye afsnit vises med sæson og nummer i både følgeoversigten og forsiden.
En åbnet serieside rydder ikke ny-markeringen. Den ryddes ved eksplicit
**Markér nye afsnit som læst**, eller når afsnittet er set færdigt.
Kvittering ændrer ikke afspilningsposition eller set-status.

## Data og opdatering

Skema 30 tilføjer kun tabeller: samlinger, medlemmer, opslag samt
initialisering og identitet for fulgte afsnit. Identiteten bruger kilde,
serie, sæson og afsnitsnummer; nye fil-id'er giver ikke falske beskeder.
Opgradering fra 28/29 bevarer favoritter, fremdrift og eksisterende følger.
Ældre følger får et kendt afsnits-snapshot som udgangspunkt uden en nyhedsflod.

Serieoplysninger opdateres ved opstart og tilbagevenden til appen, uafhængigt
af katalogets daglige synk. Succes gemmes i seks timer, fejl får fem minutters
pause, og samtidige kald deles. Skjult afspilning starter ingen nye opgaver.
Et tomt ugyldigt panelsvar sletter ikke en tidligere kendt afsnitsliste.
Der åbnes ingen videoforbindelser til metadataopslagene.

Backup v3 har et valgfrit felt til fulgte serier og deres afsnitsmarkeringer.
Ældre kopier uden feltet bevarer lokale følger. Gendannelse rører kun
genkendte kilder; ugyldige rækker afvises, og fejl rulles tilbage. Den
eksisterende adskillelse mellem installationer og sky-kopier ændres ikke.
Samlingsmetadata kan genskabes og er ikke med i sikkerhedskopien.

## Validering

Alle 1.401 tests bestod (app 1.148, core 249, radio 4), og typekontrol
bestod i alle tre workspaces.

Regressionstests bruger rigtig SQLite til migrering, kildeadskillelse,
filmidentitet, afsnitsidentitet og backup. UI-tests bruger native mocks og
kontrollerer navigation, første fokus, kvittering, cache og afbrudte opslag.
Fysisk Google TV-betjening og jeres udbyders aktuelle katalog skal stadig
bekræftes på boksen efter installation.

TMDB-reference: https://developer.themoviedb.org/reference/movie-details og
https://developer.themoviedb.org/reference/collection-details.

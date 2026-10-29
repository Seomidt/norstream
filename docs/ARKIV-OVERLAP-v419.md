# V419: kortere afbrydelse ved start forfra under en igangværende udsendelse

Fotos fra v418 viser sund afspilning fra 20:10:20 til 20:18:19 uden tabte billeder. Det endelige arkivstykke slutter ved 478,290 sekunder. Fortsættelsen bestilles fra 20:07 med 58,290 sekunders overlap. V418 gennemspiller overlappet lydløst ved 4× hastighed; klargøringen tager 17 sekunder. Dette er en konkret årsag til afbrydelsen ved denne overgang. Fotoet beviser ikke andre livefejls årsag.

V419 lader Media3 kassere samples før genoptagelsespositionen under indlæsningen. Den spiller ikke overlappet igennem i 4×. PHP- og TS-arkiv beholder skjult fillængde, så TS-extractoren ikke søger mod filens ende efter PCR eller udleder en upålidelig byteplacering. Kun TS-extractoren får et seek-kort, som altid peger på byte 0. Ved genlæsning fra byte 0 nulstilles extractorens tidsreference til 0; sample-køernes mål forbliver den ønskede genoptagelsestid. Derfor bliver begyndelsen ikke omdøbt til det tidspunkt, vi vil genoptage fra.

Varigheden forbliver ukendt, indtil den kan udledes fra de faktisk læste data. Vi bruger ikke den bestilte varighed som garanti for, at arkivet indeholder alle minutterne. Media3 kan genåbne samme arkiv fra begyndelsen for at kassere overlap hurtigt. Den tidligere indlæsning lukkes først; der oprettes ikke en ekstra afspiller eller en parallel stream. En kort indlæsningspause kan stadig forekomme.

Ændringen er afgrænset til Android-arkiv med PHP/TS. Live, HLS, film, serier, EPG-korrektion og arkivets tidskorrektion er uændrede. Extractor-fabrikkens øvrige indstillinger videresendes, inklusive undertekster. JS venter stadig på den nye kildes metadata, READY og bekræftet position. Brugerens pause, mute og hastighed bevares.

Validering: regression for loggens 58,290 sekunder, indlæsning efter seek, ingen afspilning før bekræftelse, pause/mute/hastighed, patchens versionskontrol og idempotens, alle pakke-tests og typekontrol samt Android TV runner-build. Native kompilering kontrolleres af buildet. Fysisk afspilning mod brugerens udbyder kan først bekræftes på boksen efter opdatering.

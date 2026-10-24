# v384: sekventielt arkiv og syv dages programdata

## Observeret fejl, 11. oktober 2026

En v383-rapport modtaget 19:17 dansk tid viser et program 18:20–19:00,
startet forfra 18:51. Billede og buffer går frem i 1396,050 sekunder,
hvorefter buffer og videobilleder stopper. Vagten genforbinder 19:15:06.
Fortsættelsen fra 18:43 +16,050 s klargøres, men stopper ved 18,290 s.
Lyduret ender på 48,290 s, mens antallet af viste billeder stadig er 59.
Der er ingen tabte billeder i rapporten.

Native metadata melder 72169,563 s for første fil og 71392,602 s for den
næste: næsten 20 timer for en udsendelse på 40 minutter. Det dokumenterer
en upålidelig varighed. Rapporten dokumenterer ikke rå HTTP-svar, PCR/PTS
eller serverens filindhold; den oprindelige årsag kan ikke bevises alene herfra.

## Arkivafspilning

Androids arkiv-TS får en DataSource-wrapper, der åbner og læser den normale
HTTP-kilde, men melder ukendt længde til extractoren. Dermed bruges ikke
filens sidste PCR til varighed og binær byte-søgning. Netværksgenoptagelse
med byteposition bevares; live, HLS og trailer-kilder bruger den sædvanlige
DataSource. Patchen verificerer upstream-hash og er idempotent; ukendt
Expo-kode stopper bygget.

Fortsættelsen bestiller det relevante hele arkivminut. Sekund-overlappet
læses sekventielt i samme afspiller, midlertidigt uden lyd og ved 4x hastighed,
med skjult billede og eksisterende forbindelseslag. Afspilleren sættes tilbage
til tidligere lyd/hastighed før normal afspilning; også ved fejl, timeout og
Tilbage. Dette undgår seekTo i det sammenføjede arkiv. Positivt overlap har
45 sekunders samlet deadline. En fortsættelse kan derfor vise en pause; der
påstås ikke sømløs afspilning eller test på fysisk TV.

TV-resume og stopvagt følger fremdrift i viste videobilleder, når native
videotællere findes. Et lydur med stillestående video flytter ikke resume.
Manuel TV-spoling genåbner arkivet fra målets hele minut og bruger samme
sekventielle overlap; den springer ikke tilbage til filstart via native seek.
Der beholdes én afspiller, 64 MiB bufferloft og det eksisterende retry-budget.

## Syv dage

Panel-XMLTV læses fra lokal midnat syv kalenderdage tilbage til to døgn frem.
Alle arkivkanaler inkluderes, også ikke-favoritter og kanaler med friske
programmer forude. Native svar deles i 60 feed-kanaler for at begrænse
hukommelsen med det større tidsvindue. Ny friskhedsnøgle giver en hentning
efter opdatering; dagssiden venter også på den fælles fil-hentning før genlæsning.
Dagsknapper følger mindst kanalens oplyste arkivdage, maksimalt syv, så
manglende EPG ikke skjuler arkivets datoer. Eksisterende syv-dages retention
og per-kanalens adgangskontrol bevares. Appen kan kun vise historiske titler,
som udbyderens API/fil leverer eller som allerede er gemt i cachen.

## Kontrol

1162 tests og alle workspace-typekontroller bestået under udvikling. Tests
omfatter den observerede 16,050 s fortsættelse uden positiv native seek,
lyd/hastighed ved timeout/fejl/Tilbage, et lydur der går frem uden nye billeder,
og syv hele dage for en ikke-favorit med friske programmer forude.
TV-build, manifest, version og signatur skal kontrolleres før publicering.
Hele udsendelsen og arkivserveren er ikke afprøvet herfra på en fysisk boks.

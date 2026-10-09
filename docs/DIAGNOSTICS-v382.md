# Automatisk fejlfinding fra TV v382

Start forfra er ikke ændret i denne udgave. v381's decoder, en enkelt native
medieafspiller/forbindelse og buffergrænsen på 64 MiB er bevaret. Formålet er at
undersøge faktiske stop uden skærmbilleder. Tidligere fejl, som kun lå i RAM,
kan ikke genskabes efter genstart.

## På boksen

Ingen aktiveringskode, login eller ekstra opsætning. Ved første start efter
opdateringen begynder syv dages automatisk fejlfinding. Registrering sker i
baggrunden og forsøges igen ved manglende internet. Fristen gemmes inden
netværket, så genstart eller manglende forbindelse ikke forlænger perioden.

Indstillinger → Avanceret → Streamformat og videogengivelse → Automatisk
fejlrapport viser boks-id, udløb og seneste upload. Slå fejlfinding fra
stopper lokalt straks og forsøger også at lukke server-sessionen. Dette valg
bevares ved genstart og opdatering. Der er intet tekstfelt eller tastatur.
Man kan slå til igen med ét tryk inden for perioden; aldrig med en kode.

Hvis boksen er offline, bevares outbox lokalt. Den bliver ikke sendt efter
sluk eller udløb. Installationens frist, slukvalg og upload-token indgår ikke
i backup og bliver derfor ikke flyttet til en anden boks.

## Data og begrænsninger

Lokal journal: højst 2000 linjer fra det sidste døgn, kortvisning højst 300.
Skrivninger samles i 500 ms. Ingen cloud-kald efter sluk eller udløb. Upload højst én
gang i minuttet, timeout 8 s, højst 80 linjer/300 tegn og 30 KB UTF-8 payload.
En persistent outbox beholder rapport-id ved offline/genstart og tabt svar.

Rapporter indeholder appversion, tidspunkt, loglinjer, afspillertilstand,
program-/segmenttider, position, buffer og native billedtællere. Ingen
udsendelsestitler eller streamadresser. URL'er og markerede adgangsoplysninger
redigeres både lokalt og på serveren. Serveren ignorerer ukendte felter.

Serveren beholder højst 120 normale snapshots og 30 fejl/EOF-snapshots per
session. Fejlrapporter overskrives ikke af normale minuttal. Ved sessionens
udløb slettes data med et job hver time. Supabase-skybackup berøres ikke.

## Drift og adgang

`supabase/diagnostics.sql` er deklarativ kilde til det private skema og
service-role-only RPC'er. Edge-funktionen `diagnostics` bruger
`verify_jwt=false`: automatisk tilmelding er offentlig i en afgrænset
periode, mens upload/stop kræver installationens 256-bit tilfældige token.
Token returneres kun ved oprettelsen; kendskab til boks-id giver ikke adgang.
Et tabt tilmeldingssvar kan efterlade en tom session til automatisk sletning.

Tilmeldingsvinduet åbnes i 14 dage fra backend-opsætningen og har kapacitet
til 100 installationer samt en global grænse på 120 tilmeldingsforsøg/minut.
Admin kan justere den private enrolment-række ved behov. Dette beskytter
volumen, men er ikke verificering af, at en klient er den ægte APK. Der er
intet fælles nøglemateriale eller service-role-token i APK'en.

Token-hash ligger i den private sessions-tabel; token ligger i Android
SecureStore. Service-role-nøglen er kun i Edge-runtime. Rapporterne kan kun
læses administrativt. RLS er slået til uden klientpolitikker (deny all),
PUBLIC/anon/authenticated er nægtet adgang, og RPC'erne er SECURITY INVOKER.
Serveren har højst 150 snapshots per session og sletter udløbne sessioner
hver time. Sky-backup og øvrige projekttabeller er uændrede.

Rapporter findes ved privat join mellem sessions og reports via support_code,
som skærmen kalder boks-id. Ingen rå mediefejl eller credentials må udskrives
fra tests eller drift.

Kontroller før udgivelse: historisk v28-migrering/genstart, TTL/loft,
redigering, UTF-8-loft, offline/genstart/idempotens, automatisk tilmelding,
stop og udløb på tværs af genstart, stop under tilmelding, serverens tokens,
kvoter/expiry, private grants, advisors og den faktiske TV-APK (version,
signatur, Hermes og native decoder/billedtællere).
Dette er ikke en fysisk TV- eller IPTV-provider-test.

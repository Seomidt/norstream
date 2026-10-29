# V425: start forfra kun for afsluttede udsendelser

## Hvorfor (27. oktober 2026)

Brugeren: "Kan du lave så start forfra ikke er aktiv så længe en udsendelse er
live, for det virker ikke og kommer nok aldrig til at virke, men så aktiv så
snart udsendelsen er færdig." Fra v373 til v424 er stykkeskiftet ved den
levende kant forsøgt rettet igen og igen: én vedvarende afspiller (v373), seek
efter `sourceLoad` (v379), native kø i Media3 (v395, rullet tilbage i v397),
stykker uden overlap (v419) og oplyst varighed til Media3 (v424). Hver gang
frøs eller hakkede billedet for brugeren ved skiftet.

Grundproblemet ændrer ingen af rettelserne: panelet tillader **én**
forbindelse og gemmer arkivet i **hele minutter**. Vil man se en udsendelse
forfra, mens den sendes, må appen hente arkivet i stykker op til den levende
kant (nu minus 90 s) og hente et nyt stykke, hver gang et slutter. Hvert
stykkeskift er et kildeskift midt i det man ser. Brugeren har besluttet:
Start forfra tilbydes ikke, mens en udsendelse sendes, og bliver mulig så snart
den er slut.

## Reglen

- `archiveComplete(programme, nowMs)` i `features/player/archiveContinuation.ts`:
  sluttiden rundes op til næste hele minut, og der lægges `RESTART_SETTLE_MS`
  (120 s) til. Kanten halter 90 s efter live, og panelet lukker det sidste
  minut et par sekunder senere; så dækker ét arkivstykke hele udsendelsen.
- Samme regel på alle fire steder: programbladet (`programmeOptions`),
  gitterets markering (`guideAction`: ' ▶' og restart), Hele dagen
  (` · ⏱ Start forfra` på rækken) og afspillerbjælken (`canRestart` i
  `PlayerScreen`). En udsendelse der sendes eller lige er sluttet, får kun
  "Se kanalen".
- Guiden og Hele dagen afgør det med klokken (`now`, tikker hvert 60 s), ikke
  med cellens fastfrosne tilstand; knappen kan derfor komme op til et minut
  efter de to minutter. Afspilleren sætter én timer til sluttid + 120 s og
  tegner bjælken igen præcis når knappen kan komme.
- Afspillerens knap gælder den udsendelse man sad og så (`now` hentes ikke
  igen ved programskift). En udsendelse der allerede var slut, da man kom til
  kanalen, startes forfra fra guiden eller Hele dagen.

## Teksterne

- Programbladet, udsendelsen sendes: "Start forfra bliver muligt, når
  udsendelsen er slut (kl. HH:MM)."
- Programbladet, slut for under to minutter siden: "Start forfra bliver
  muligt om et øjeblik: arkivet får udsendelsens sidste minutter."
- Intet arkiv eller ingen dialekt: de hidtidige tekster. En kommende
  udsendelse får ingen arkivforklaring.
- Afspillerbjælken: på knappens plads en dæmpet tekst uden fokus, "Start forfra
  bliver muligt, når udsendelsen er slut (kl. HH:MM)" i lokal tid; Tekst-knappen
  får det foretrukne tv-fokus. Panelet for intet arkiv / ingen dialekt / ingen
  EPG er uændret.

## Afspilningsreglen

- `archiveWindow` bestiller som før ét stykke fra start til min(slut + 15 min,
  nu − 90 s) i hele minutter. Er udsendelsen slut i to minutter, dækker ét
  stykke den hele.
- `archiveContinuation`: sluttede strømmen selv (`streamEnded`), og kanten
  nåede EPG-slut (minus 2 s) eller længere, er svaret `done`: tilbage til
  oversigten, ingen flere stykker. Loggen: `udsendelsen er slut v425: kanten …;
  EPG-slut …, slutgraense …; henter ikke flere stykker`.
- Slutter stykket **før** EPG-slut (panelet leverede for lidt midt i
  udsendelsen), fortsættes eller ventes der som i v424 (op til 5 s før et helt
  minut regnes som nået).
- En fejl eller et hæng inde i slutmargenen er ikke en slut: der genforbindes
  fra det nåede punkt, så en kamp der trækker over, kan ses videre.

## Afvejning: udsendelser der trækker over

Lukker panelet selv strømmen ved eller efter EPG-slut, afsluttes der nu i
stedet for at hente resten af de 15 minutters margen; et nyt stykke dér var
netop det, der frøs. Kører strømmen videre forbi EPG-slut, spilles den til
margenens slut som før. Prisen betales kun, når panelet lukkede.

## Ikke ændret

- `PlayerScreen` afspiller stadig ethvert program det får som `startFrom`,
  også et igangværende; kun det brugerfladen tilbyder er indhegnet.
- `archiveContinuation` ved underskud midt i udsendelsen (fortsæt/vent/live).
- De 15 minutters slutmargen og 90 s afstand til live.
- "Se videre i arkivet" på forsiden har ingen indhegning (kun fremdriftsrækker
  fra før v425 kan ramme den); tages i et senere trin.

## Afprøvning på boksen

1. En udsendelse der sendes: pil op i afspilleren viser ingen knap, men
   teksten med sluttiden. Guiden: programbladet uden knap og med teksten,
   gitteret uden ▶, Hele dagen uden ⏱.
2. To minutter efter en udsendelse er slut (op til tre på grund af minut-tikket):
   Start forfra i guiden og i Hele dagen spiller fra start til slut uden
   "Venter på næste arkivstykke …" og uden stykkeskift, og går derefter tilbage
   til oversigten. Vis loggen har én `beder om`-linje og `udsendelsen er slut v425`.
3. Prøv igen efter en arkivfejl fortsætter fra samme sted. Tilbage går til
   oversigten og slipper forbindelsen.

## Fremtiden: ét flow

Indstillinger → Test start forfra (`features/player/timeshiftProbe.ts`, v355)
måler, om panelet leverer arkivet som en HLS-spilleliste der **vokser** (A:
læst to gange med 30 s imellem, B: kun det der findes, C: .ts-hovederne).
Vokser den, kan en live start forfra bygges senere som ét flow: spillelisten
spilles som live med spoling og uden stykkeskift. Gå aldrig tilbage til
stykkevis sammensyning ved kanten. Se `OVERDRAGELSE.md` ved "v355" og
"Test start forfra".

## Ikke verificeret herfra

Ingen fysisk afprøvning mod brugerens panel eller boks. Alle 1389 tests i
`packages/app` er grønne, og typekontrollen er ren.

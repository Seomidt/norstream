# Start forfra: genforbindelsen i v380

## Ny dokumentation fra boksen

Brugerens to fotos af v379 den 8. oktober 2026 viser:

- Arkivet åbnes fra 06:00, 16 minutter; faktisk længde 898,960 sekunder.
- Ved 06:20:19 registrerer appen stilstand ved 110,268 sekunder med buffer til 201 sekunder.
- Ny kilde fra 06:01 skal spole 50,268 sekunder. Metadata kommer 06:20:21.
- Appen genforsøger allerede 06:20:29, derefter opgiver den 06:20:41.
- Afspilleren melder først klar 06:20:49.

Buffer frem til 201 sekunder beviser ikke årsagen til stilstanden. Det kan
ikke udledes, at der blot skal downloades mere. Den gamle log har kun
fejltypen ukendt og kan ikke skelne en Android-fejl fra en genforbindelse
udløst af forsinkede JavaScript-hændelser.

## Rettelser

1. `PlaybackConnection.load` afsluttes først efter en frisk position har
   bekræftet det positive seek. Metadata, første buffer og seek deler en
   absolut deadline på 30 sekunder for arkiv (8 for live). READY-hændelser
   forlænger aldrig deadlinen. Et sent svar efter timeout starter ikke en
   opgivet kilde. Tidshændelser må bekræfte seek mens load venter.
2. Den konkurrerende 8-sekunders seek-timer i skærmen er fjernet. Den afbrød
   en 16-sekunders seek-buffer fra brugerens foto, selv om kilden senere
   kunne blive klar. Path-TS kan stadig prøve HLS ved et ignoreret seek;
   PHP-dialekten beholder sin kilde og bliver ikke skiftet til live.
3. Stilstandskontrollen læser native currentTime. En gammel JS-position må
   ikke alene udløse genforbindelse, når native uret stadig går fremad.
   Loggen siger nu afspilningsuret, da et ur ikke beviser en frosset frame.
4. En idempotent, SHA-256-kontrolleret install-patch udvider Androids
   PlaybackError med numerisk Media3-fejlkode og fejlkildetype. Afspilleren
   ændres ikke. Loggen accepterer kun heltalsfelter inden for faste grænser
   og faste kategorier; URL, kodeord og rå fejltekst logges aldrig. Ukendt
   upstream-kode stopper bygget, og ekstra felter er valgfrie i JS.

Én native afspiller, 64 MiB arkivbuffer, retry-budget, faktiske arkivpositioner,
trailers, filmfiltre og navigation er bevaret. Der åbnes ingen parallelle
streamforbindelser.

## Verifikation og begrænsning

Regressionen reproducerer seek til 50,268 sekunder, 16 sekunders buffering
og forsinket READY uden et ekstra replace. En anden regression viser, at
READY-støj ikke holder et ignoreret seek i live efter deadlinen. Alle gamle
kildeskift-, annullering-, pause- og arkivsluttests køres også.

Den oprindelige stilstand på TV 2 under en igangværende udsendelse er stadig
ikke reproduceret på fysisk hardware her. V380 retter konkrete fejl i
kontrol og genforbindelse; den dokumenterer ikke fejlfri TV 2-afspilning.
Fysisk kontrol skal være start forfra under en igangværende TV 2 DK-udsendelse
og fortsættelse forbi det tidligere stop. Ved fortsat fejl giver loggen nu
native fejlkoder. Ingen legitimationsoplysninger er tilgængelige til en
provider-streamtest.

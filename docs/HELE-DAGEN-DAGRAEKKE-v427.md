# V427: "I dag" viste samme ugedag i sidste uge

## Fejlrapporten

Brugeren (29. oktober 2026): "Når man kigger på i dag, viser den programmer for
torsdag i sidste uge." Dagen før meldte brugeren det samme for onsdag 28/10 og
onsdag 21/10; v426 rettede derfor uret efter standby, men fejlen kom igen.

## Hvad loggen viste

Diagnostikloggen fra v426 (TV2, Hele dagen, 29/10 kl. 15.48–15.51):

- Datoen var rigtig: `dato 2026-10-29, dag 0` med 62–67 programmer.
- Dagvælgeren blev tegnet med 6 dage (arkivets 3 dage tilbage + i dag + 2 frem).
- Den gemte tabel og panelets friske svar gik 6–7 dage tilbage. Når tabellen
  var læst, voksede dagrækken til 10 dage, og de fire nye knapper kom ind
  **foran** "I dag".
- 3–7 sekunder efter åbning stod der `dato 2026-10-22, dag -7` (også 28/10
  kl. 20.12). Kun et tryk på en dagknap kan vælge en anden dag.

Den første knap i den voksne række er netop 7 dage tilbage, altså samme ugedag
i sidste uge. Det passer med begge fejlrapporter. På tv flytter fokus, når der
sættes knapper ind foran den fokuserede, sandsynligvis til den første knap;
OK valgte så sidste uges dag, mens man troede, man stod på "I dag". Selve
fokusflytningen er ikke målt på boksen; v427 logger den nu.

EPG-tiderne er ikke årsagen: panelets API giver epoch-sekunder, panelets XML-fil
har dato og tidszone i hvert tidsstempel, og intet i appen flytter programmer
med dage eller uger. Forskellen mellem 446 og 480 programmer i loggen er
oprydningen af gamle dage efter arkivets længde, ikke en anden kilde.

## Rettelsen

- Dagrækken bygges først, når den gemte tabel er læst, og ligger fast resten
  af besøget (pr. kanal og kalenderdag). Den vokser ikke, når panelets svar
  rækker en dag længere tilbage; det ses ved næste åbning. v280's regel om at
  vise så langt tilbage, som tabellen rækker, er bevaret.
- Et skift af kanal eller kalenderdag åbner altid på "I dag". Siden bliver
  monteret, mens afspilleren er fremme og ved kanalskift, og før fulgte en valgt
  dag med til næste kanal.
- Loggen: `hele dagen v427: dagraekke fast for besoeget: N dage`, `fokus paa
  <dag> (dag X), valgt dag Y` og `valgt <dag> (dag X)`.

## Kontrol

To nye tests i `features/guide/screens.test.ts` fejler på v426-koden og består
nu: rækken får ingen "tor 22.10" foran "I dag", når panelets svar rækker længere
tilbage end det gemte, og et kanalskift efter valg af sidste uges dag viser i dag.
Fysisk fokus på boksen er ikke afprøvet herfra.

## Afprøvning på boksen

Åbn Hele dagen på TV2, vent tre sekunder, og tryk OK uden at flytte fokus. Der
skal stå "I dag" med dagens programmer. Send "Vis loggen", hvis det ikke passer:
linjerne `fokus paa` og `valgt` viser, hvilken knap fjernbetjeningen ramte.

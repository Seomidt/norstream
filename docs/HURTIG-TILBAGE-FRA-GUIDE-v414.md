# v414: Hurtigere vej fra Guide til menuen

## Årsag og ændring

TV-guiden monterede samtlige favoritkanaler og læste to ugers programdata
for alle kanaler på én gang. En ustabil callback tegnede alle rækker igen
ved fokus- og previewskift. Telefon-guidens egne dataeffekter kørte desuden
samtidig på TV og kunne bestille de samme EPG-kald igen.

TV-listen bruger nu et afgrænset vindue med fast rækkehøjde. Programdata
læses for området omkring de synlige rækker, i små afbrydelige batches.
Tidsvinduet på syv dage hver vej bevares. Telefon-effekterne springes over
på TV; nu/næste-boksen følger fortsat det valgte programs opdateringer.

Menuen har sin egen komponent og tilstand. Når Tilbage åbner eller giver
menuen fokus, tegnes skjulte film-, radio- og forsidevisninger ikke igen.
Native fokus anmodes i samme Back-handler. Et gammelt fokusforsøg fra
dagssiden stoppes synkront, før menuen anmodes, også før næste React-commit.

Menuens lokale log måler tiden fra Back-handleren til native bekræftelse
på den aktive menufane. Målingen indeholder ingen kanaladresse.

## Betjening

Tilbage fra guidens gitter går til menuen. Fra hele dagen eller et
programblad lukkes den åbne underside først. Pil højre går fra menuen ind
i guiden igen. Favoritter, afspilningspositioner og kildeindstillinger
ændres ikke.

## Kontrol

Alle 1.425 tests bestod (app 1.172, core 249, radio 4). Typekontrol
bestod i alle tre workspaces.

Regressionstests dækker en liste med 1.000 kanaler, tilbagevenden til en
kanal uden for det monterede vindue, cache/EPG ved afbrudt navigation,
annullering før React-commit, stabile callbacks og isolering af menuens
tegning. Tests af fokus bruger native mocks; fysisk fjernbetjening på
brugerens TV er ikke målt fra dette miljø.

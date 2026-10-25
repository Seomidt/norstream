# V419: EPG-opdateringer må ikke blandes

Brugerens fotos viser DR2 med to overlappende programmer: En by i provinsen 19:50–20:50 og Den klassiske musikquiz 20:00–21:00. Begge mærkes Sendes nu. Dette er forskelligt fra en ensartet tidszoneforskydning.

En regressionstest med rigtig SQLite genskaber en fejl i den tidligere kode: To samtidige kald til upsertProgrammes med replaceWindow sletter først hver deres vindue i separate transaktioner, hvorefter begge indsætter rækker. Resultatet er en blanding af de to snapshots. Selv en sluttid for en uændret starttid kan blive skrevet tilbage af det forrige svar.

Nu serialiseres EPG-skrivninger pr. database. Sletning og indsættelse af hver kanals nye vindue sker i samme transaktion. Store batches giver tråden luft mellem kanaler, og en skrivefejl ruller vinduet tilbage. En fejl blokerer ikke senere svar. Andre kanaler, databaser og den ældre arkivoversigt uden for det nye vindue bevares.

EPG-data har sin egen hukommelsesrevision. Tidslinjen kasserer gamle programvinduer efter en skrivning, inklusive et gammelt SQL-svar der lander sent. Kanalmenuer, film og serier beholder deres separate cache. Der er ingen ny tidsforskydning i denne rettelse.

Skema 32 gør kort og fuld EPG-hentetid gammel én gang ved opgraderingen. De eksisterende programmer bliver stående, indtil friske data erstatter dem. De normale intervaller og begrænsningen til synlige kanaler bevares derefter. Favoritter, positioner og kildekorrektioner bevares.

Testene dokumenterer den konkrete samtidighedsfejl og den rettede lagring. Uden brugerens rå udbydersvar kan det ikke bevises, at netop denne fejl er den eneste årsag til alle viste overlap; hvis et enkelt nyt udbydersvar allerede indeholder overlap, kræver det særskilt undersøgelse.

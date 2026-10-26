# V420: kun EPG tilbage til v400

Brugeren bad 26. oktober 2026 om at vende tilbage til den fungerende EPG fra v400 og præciserede, at andre funktioner skulle bevares.

Reference: commit `1dd73ee6b1ba6baf1488e2e293705b8f8434c575` (v400). Det er også den direkte forgænger til v401. Ændringen lægges oven på v419 som en ny commit og en opdatering med versionCode 420. Historikken omskrives ikke.

Disse funktioner er hentet direkte fra referencen: guide-skærme og tidslinje, opslag og skrivning af programmer, EPG-hentetider, kort og fuld panel-EPG, panelets XMLTV-fallback og sportens opslag i programoversigten. De berørte tests følger den tilbageførte kode. De senere tidslinje-cache- og annulleringstests udgår sammen med de funktioner, de testede.

Skema 33 fjerner den senere automatiske EPG-korrektion og genhenter panelets afledte programdata én gang. M3U-programmer bevares. Programtid læses igen direkte fra udbyderens tidsstempler. Kompatibilitetsvisningen for v418/v419 er en identitetsvisning, så gamle integrationspunkter ikke forskyder tiderne. En sikkerhedskopi kan ikke genindføre den tilbageførte EPG-forskydning.

Arkivtidens separate indstilling og knapper bevares. Den tidligere Programtider-kontrol skjules. Afspillerkode, native patches, live/HLS, lyd, film, serier, filmsamlinger, fulgte serier, coverindlæsning, sportens favoritmenu, favoritter og skybackupens øvrige funktioner er ikke tilbageført.

Opgraderingstests fra skema 31 og 32 kontrollerer bevarelse af favoritgrupper, gruppemedlemmer, arkivpositioner, filmpositioner, fulgte serier, tema og separat arkivkorrektion. Oprydningen sker kun én gang. Senere opstart bevarer den nye EPG-cache.

Der kan ikke foretages en fysisk prøve på brugerens TV herfra. Udgivelsen verificeres med runner-build, APK-manifest, signatur og digest af den offentlige APK.

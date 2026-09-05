# NorStream — Plan 2: Navigation

**Goal:** Gør 285 kategorier og 22.142 kanaler navigerbare: landegruppering med
flag, skjulte lande, søgning øverst, kategori-favoritter der kopieres og kan
grupperes, og et mini-preview der respekterer panelets ene forbindelse.

**Spec:** `docs/superpowers/specs/2026-09-05-navigation-og-epg-design.md`
(afsnit 5, 6, 7). Bygger oven på Plan 1, som ejer skemaet og EPG'en.

**Forudsætter:** Plan 1 er gennemført. Skema v2 findes allerede med
`favorites.source_category_id` og `hidden_countries`.

---

## Globale constraints

Som Plan 1. Derudover:

- **Landeudledning hører i `packages/core`.** Den er ren tekstbehandling, den
  skal testes ét sted, og TV-appen (delprojekt 3) får brug for den samme.
- Flag er emoji sammensat af regional indicator-symboler ud fra ISO 3166-1
  alpha-2. Ingen billedfiler, ingen afhængighed.
- **Ingen kanal må kunne forsvinde.** Et uigenkendt kategorinavn havner under
  **Øvrige**; det er spec'ens eneste værn mod at landeudledningen tager fejl.

---

## Afvigelser fra spec'en, og hvorfor

### 1. Mini-preview lukker ned før navigation, ikke kun før næste preview

Spec afsnit 7 kræver at previewet lukker den forrige stream ned før det åbner
den næste. Den samme begrænsning gælder overgangen fra preview til den rigtige
afspiller: åbnes `PlayerScreen` mens previewet stadig holder forbindelsen,
afviser panelet den stream brugeren rent faktisk bad om — og en fungerende
afspilning bliver til en fejl, forårsaget af en bekvemmelighedsfunktion.

**Afgjort:** tryk på en kanal frigiver previewet og venter på frigivelsen, før
skærmen skifter. Previewet er også slået fra så længe afspilleren er åben.

### 2. Landeudledningen springer ét indledende markør-ord over

Spec'en siger "kategorinavnets præfiks". Rene præfikser fanger ikke
`VIP DENMARK SPORT`, som er en udbredt Xtream-konvention, og den kategori ville
lande under **Øvrige** sammen med `4K UHD 3840P`.

**Afgjort:** ét indledende ord fra en kort liste af markører (`VIP`, `HD`, `FHD`,
`SD`, `UHD`, `4K`) springes over, hvorefter der matches igen. Kun ét ord, og kun
fra listen — jo mere gætteri, jo større risiko for at gruppere forkert, og
spec'ens risikotabel foretrækker **Øvrige** frem for et forkert flag.

---

## Filstruktur

| Fil | Ansvar |
|---|---|
| `packages/core/src/country/countries.ts` | Kategorinavn → land, kode og flag |
| `packages/app/src/storage/countries.ts` | Landeoversigt med antal, skjulte lande |
| `packages/app/src/storage/favorites.ts` | Kategori-favoritter og gruppering |
| `packages/app/src/features/home/HomeScreen.tsx` | Fanebladsskal |
| `packages/app/src/features/browse/BrowseScreen.tsx` | Søg → lande → kategorier |
| `packages/app/src/features/favorites/FavoritesScreen.tsx` | Grupperede favoritter |
| `packages/app/src/features/settings/SettingsScreen.tsx` | Preview, skjulte lande, log ud |
| `packages/app/src/features/preview/MiniPreview.tsx` | 16:9-vinduet |

---

### Task 1: Landeudledning i core

**Files:** create `packages/core/src/country/countries.ts` + test

**Produces:** `deriveCountry(categoryName: string): Country | null`,
`countryFlag(code: string): string`, `interface Country { code, name, flag }`

- [ ] Normalisér: store bogstaver, ikke-alfanumerisk → mellemrum, klem mellemrum
- [ ] Match det **længste** kendte landeudtryk fra begyndelsen, så
      `UNITED KINGDOM` ikke taber til et kortere `UNITED`
- [ ] Understøt flerordede navne og gængse aliaser (`UK`, `USA`, `SE`,
      `DK`, `NO`, `FI`, `DE`, `NL`, `FR`, `ES`, `IT`, `PL`, `TR`, `AR`)
- [ ] Navnet returneres på dansk: `Danmark`, `Storbritannien`, `Tyskland`
- [ ] Ét markør-ord springes over, se afvigelse 2
- [ ] Ingen match → `null`; kalderen viser **Øvrige**
- [ ] Tests: `DENMARK HD & HEVC` → Danmark; `SWEDEN SPORT` → Sverige;
      `VIP DENMARK` → Danmark; `4K UHD 3840P` → `null`; `UK SPORT` →
      Storbritannien; `UNITED KINGDOM` slår ikke fejl på `UNITED`;
      tom streng → `null`; flag-sammensætning for `DK` → 🇩🇰

### Task 2: Landeoversigt og skjulte lande i lageret

**Files:** create `packages/app/src/storage/countries.ts` + test

**Produces:** `listCountryGroups(db)`, `hideCountry(db, name)`,
`unhideCountry(db, name)`, `listHiddenCountries(db)`

- [ ] `listCountryGroups` grupperer kategorier efter `deriveCountry` og tæller
      kanaler per land i **én** forespørgsel, ikke én per kategori
- [ ] Skjulte lande udelades af oversigten, men deres kanaler bliver liggende i
      `channels` og findes stadig via søgning — spec afsnit 5
- [ ] Øvrige sorteres altid nederst; resten sorteres efter dansk navn
- [ ] Tests: gruppering og antal; skjult land forsvinder fra oversigten men ikke
      fra søgning; **Øvrige** samler det uigenkendelige

### Task 3: Kategori-favoritter

**Files:** create `packages/app/src/storage/favorites.ts` + test;
modify `channels.ts` så `setFavorite` kan bære `source_category_id`

**Produces:** `addCategoryToFavorites(db, categoryId)`,
`refreshCategoryFavorites(db, categoryId)`, `listFavoriteGroups(db)`

- [ ] "Tilføj alle" **kopierer** kanalerne ind i `favorites` med
      `source_category_id`. Spec afsnit 6: den beregnede variant gør "fjern
      denne ene" tvetydig
- [ ] `INSERT OR IGNORE`, så en kanal der allerede er favorit beholder den
      kategori den først kom fra og ikke duplikeres
- [ ] `refreshCategoryFavorites` tilføjer kun nye kanaler; den fjerner aldrig
      noget brugeren selv har slettet
- [ ] `listFavoriteGroups` returnerer sektioner: kategorinavn plus kanaler,
      med de løse favoritter (`source_category_id IS NULL`) i en egen sektion
- [ ] Tests: tilføj alle; tilføj igen efter at panelet fik en ny kanal; fjern én
      kanal og bekræft at den ikke kommer tilbage før man trykker opdatér;
      gruppering med og uden kilde-kategori

### Task 4: Fanebladsskallen

**Files:** create `HomeScreen.tsx`; modify `App.tsx`

- [ ] Fire faneblade: Favoritter, Kanaler, Guide, Indstillinger
- [ ] Startskærmen er **Favoritter**. Er den tom, vises en kort besked der peger
      på Kanaler — ikke en tom liste
- [ ] Ruterne holdes fortsat i en `Route`-union i `App.tsx`; ingen
      navigationsbibliotek trækkes ind for fire faneblade

### Task 5: Browse-skærmen

**Files:** create `BrowseScreen.tsx`; modify `ChannelListScreen.tsx`

- [ ] Søgefeltet ligger **øverst** og søger på tværs af alle kanaler, også i
      skjulte lande
- [ ] Uden søgetekst: landeliste med flag og kanalantal → kategorier i landet →
      kanaler
- [ ] Tilbage-navigation inden for skærmen, ikke via app-ruten
- [ ] Langt tryk på et land skjuler det, med en fortryd-mulighed i indstillinger
- [ ] Kategori-rækken har "Tilføj alle" som spec afsnit 6 beskriver

### Task 6: Favoritskærmen

**Files:** create `FavoritesScreen.tsx`

- [ ] Sammenklappelige sektioner per kilde-kategori
- [ ] "Opdatér" per sektion henter kategoriens nye kanaler ind
- [ ] Tom tilstand som i Task 4

### Task 7: Mini-preview

**Files:** create `MiniPreview.tsx`; modify `ChannelListScreen.tsx`,
`SettingsScreen.tsx`, `settings.ts`

- [ ] Starter først når listen har stået stille i 800 ms
- [ ] Lyd fra som standard; ét tryk slår lyd til; fuldt tryk åbner afspilleren
- [ ] **Sekventiel nedlukning:** kilden sættes til `null`, der ventes, og først
      derefter åbnes den næste. Aldrig to streams i luften
- [ ] Ét genforsøg efter kort forsinkelse hvis panelet afviser
- [ ] Efter andet afslag: en forståelig dansk besked, aldrig den rå fejl —
      stream-URL'en indeholder panelets adgangskode
- [ ] Kan slås fra i indstillinger; indstillingen ligger i `settings`-tabellen
- [ ] Frigives før navigation til afspilleren, se afvigelse 1

### Task 8: Indstillinger

**Files:** create `SettingsScreen.tsx`

- [ ] Mini-preview til/fra
- [ ] Skjulte lande med mulighed for at vise dem igen
- [ ] Log ud: rydder credentials **og** `last_sync_ms`

      Det lukker parkeret punkt 1 fra overdragelsen: uden det ville et nyt panel
      vise det gamles kanaler i op til et døgn, fordi kanal-synken springes over
      når `last_sync_ms` er under et døgn gammel.

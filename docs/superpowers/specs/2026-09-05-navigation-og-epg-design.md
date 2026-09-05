# UHF Play — Navigation og EPG: design

**Dato:** 2026-09-05
**Status:** Godkendt design, klar til implementeringsplan
**Supplerer:** `2026-09-04-uhf-play-design.md`, som fortsat gælder for alt dette dokument ikke ændrer.

---

## 1. Baggrund

Appen kører på enhed mod et rigtigt panel. Tre problemer viste sig med det samme, og alle tre skyldes at det oprindelige design antog en langt mindre installation end virkeligheden.

**Målt på brugerens panel:**

| | Antaget i oprindeligt design | Faktisk |
|---|---|---|
| Kategorier | en håndfuld | **285** |
| Kanaler | hundreder | **22.142** |
| XMLTV-fil | 10-50 MB | **98 MB** |
| Kanaler med `epg_channel_id` | antaget alle | **13%** (3.009) |
| Kanaler med arkiv | — | 1.095 |
| Samtidige forbindelser | ikke overvejet | **1** |

Konsekvenserne:

- **EPG virker ikke.** Appen henter hele XMLTV-filen. 98 MB overskrider dens 60-sekunders timeout på en telefon, hentningen afbrydes, og data lander aldrig.
- **Start-forfra virker ikke.** Knappen kræver at vide hvornår det aktuelle program begyndte. Det står i EPG'en, som aldrig kommer ind. DR1 og TV 2 har ellers tre dages arkiv.
- **Navigationen er ubrugelig.** En vandret kategori-række designet til en håndfuld poster indeholder 285. Det er reelt umuligt at finde Danmark.

## 2. Den bærende opdagelse

Panelet har endpointet `get_short_epg`, som henter programoversigt for **én kanal ad gangen** via `stream_id`:

```
GET /player_api.php?username=U&password=P&action=get_short_epg&stream_id=247634&limit=3
```

Svaret er nogle få kilobyte og indeholder `title` og `description` **base64-kodet**, samt `start_timestamp` og `stop_timestamp` som Unix-sekunder.

Det afgørende: **det slår op på `stream_id`, ikke på `epg_channel_id`.** Alle 22.142 kanaler har et `stream_id`; kun 13% har et EPG-id. Skiftet fjerner hele den kobling der ellers ville efterlade 87% af kanalerne uden programdata — og med den den mest fejlbehæftede del af det oprindelige design.

## 3. Mål og ikke-mål

### Mål

- EPG virker uden at hente 98 MB
- Start-forfra virker, og får et synligt sted at bo
- Navigation der kan bære 285 kategorier og 22.142 kanaler
- Hele kategorier kan lægges i favoritter på én gang
- Landegruppering med flag, og mulighed for at skjule lande
- Live-preview af den kanal man står på

### Ikke-mål

- **XMLTV understøttes ikke længere.** Vejen udgår helt.
- **Intet gitter over alle kanaler.** Guiden viser altid en afgrænset mængde.
- **Ingen påmindelser om kommende programmer.** Guiden viser dem, men gør intet ved dem.
- **Ingen ændring af TV-appen** (delprojekt 3) eller recorder-serveren (delprojekt 4).

## 4. EPG: hentning og cache

### Nøgleskift

`programmes.channel_id` indeholder fremover Xtreams **`stream_id`**, ikke et XMLTV-kanal-id. Kolonnenavnet bevares for at holde ændringen lille; feltets betydning dokumenteres i skemaet.

### Nyt i core

`XtreamClient` får `getShortEpg(streamId: string, limit?: number): Promise<Programme[]>`, som:

- kalder `action=get_short_epg`
- base64-afkoder `title` og `description`
- omsætter `start_timestamp`/`stop_timestamp` (sekunder) til `Date`
- springer poster over der mangler titel eller tidsstempler, uden at kaste

Afkodningen hører i core, ikke i appen, så den testes ét sted sammen med resten af panel-oversættelsen.

### Cache-regler

En kanals EPG hentes igen **kun** når mindst én af disse gælder:

- Der findes ingen data for kanalen
- `fetched_at` er ældre end **30 minutter**
- Det nyeste gemte program for kanalen er allerede slut

Den sidste regel er den vigtige: åbnes DR1 tre gange på en aften, hentes der én gang. Skifter programmet, hentes der igen. Scroll frem og tilbage i listen rammer cachen.

`fetched_at` gemmes per kanal i en ny tabel, ikke per programrække, så et enkelt opslag afgør om hentning er nødvendig.

### Rydning

Programmer der sluttede for mere end 12 timer siden slettes, som i dag. Reglen om ikke at rydde når intet blev hentet bevares.

## 5. Navigation

### Startskærm

**Favoritter.** Er der ingen endnu, vises en kort besked der peger på browse frem for en tom liste.

### Browse: to niveauer

```
Lande                         Kategorier i landet          Kanaler
Danmark          (979)   ->   DENMARK HD & HEVC       ->   DNK| DR1 HD
Sverige        (1.204)        DENMARK SPORT HD             DNK| DR2 HD
Storbritannien                DENMARK TV2 PLAY PPV         ...
Oevrige                       4K UHD 3840P
```

Landet udledes af kategorinavnets præfiks: `DENMARK HD & HEVC` → Danmark. Flaget udledes af landet og vises som emoji-flag.

Kategorier uden genkendeligt land — `4K UHD 3840P`, `4K RELAX 1920P` — samles under **Øvrige**. De forsvinder ikke; de grupperes bare ikke.

Brugeren kan **skjule lande** han aldrig bruger. Skjulte lande forsvinder fra listen, men deres kanaler kan stadig findes via søgning.

### Søgning

Uændret, men flyttes øverst. Den er i praksis den hurtigste vej til en kendt kanal, og bør være det første man møder på browse-skærmen.

## 6. Kategori-favoritter

"Tilføj alle" på en kategori **kopierer** dens kanaler ind i favoritterne. De er derefter brugerens egne, og enkelte kan fjernes frit.

Alternativet — at favorisere selve kategorien og beregne listen løbende — blev fravalgt, fordi "fjern denne ene kanal" så bliver tvetydigt: kanalen hører til gruppen. Kopiering er forudsigelig. Tilføjer udbyderen senere kanaler til kategorien, kan brugeren trykke **opdatér** og få de nye med.

Hver favorit husker hvilken kategori den kom fra (`source_category_id`), så favoritskærmen kan gruppere dem i sammenklappelige sektioner. Uden det ville en enkelt "tilføj alle" på Danmark give 979 kanaler i én flad liste.

## 7. Mini-preview

Et 16:9-vindue øverst i kanallisten der viser den kanal brugeren står på.

- **Starter først når scroll står stille** i cirka 800 ms. Ellers ville en hurtig scroll åbne snesevis af streams.
- **Lyd fra som standard**, med et tryk for at slå til. Fuldt tryk åbner den rigtige afspiller.
- **Kan slås fra i indstillinger.**

### Begrænsningen der former designet

Panelet tillader **én samtidig forbindelse**. Previewet skal derfor lukke den forrige stream helt ned, før det åbner den næste — og kun én stream må nogensinde være i luften. Implementeringen venter på at afspilleren melder frigivet, og prøver én gang igen med kort forsinkelse hvis panelet afviser.

**Det gør denne funktion appens mest skrøbelige del, og det kan ikke designes væk.** Derfor skal den være nem at slå fra, og en afvist forbindelse skal vise en forståelig besked frem for at fejle stille.

Det betyder også at brugeren ikke kan se på telefon og fjernsyn samtidig. Det er panelets vilkår, ikke appens.

## 8. Guiden

Et tidsgitter: vandret tid, lodret kanaler.

```
            19:00        20:00        21:00
DR1      | TV Avisen  | De frivillige      |
DR2      | Deadline   | Dokumentar         |
TV 2     | Nyhederne  | Sporten | Film     |
```

Gitteret viser **den mængde kanaler brugeren allerede er i** — favoritterne, eller den kategori der browses. Aldrig alle 22.142. Kun synlige rækker henter data, og de rammer cachen fra afsnit 4.

### Guiden er hjemstedet for start-forfra

Tryk på et program:

| Programmet | Handling |
|---|---|
| sendes nu | afspil kanalen |
| er slut, og kanalen har arkiv | start forfra fra programmets starttidspunkt |
| er slut, uden arkiv | ingenting, feltet er tydeligt inaktivt |
| kommer senere | ingenting |

Det gør funktionen synlig i stedet for at gemme den bag en knap man skal vide findes.

### Panelets tidszone

Panelet oplyser sin tidszone i `server_info.timezone` (målt: `Europe/Amsterdam`). Den læses ved onboarding og gemmes som `panelOffsetMinutes`, så timeshift-URL'er bygges med det rigtige offset. Det lukker et punkt der stod åbent i det oprindelige design, fordi det ikke kunne afgøres uden et rigtigt panel.

## 9. Skemaændringer

| Ændring | Begrundelse |
|---|---|
| `programmes.channel_id` betyder nu `stream_id` | Fjerner afhængigheden af `epg_channel_id`, som 87% af kanalerne mangler |
| Ny tabel `epg_fetch (stream_id TEXT PK, fetched_at INTEGER)` | Ét opslag afgør om EPG skal hentes igen |
| `favorites` får `source_category_id TEXT` | Så favoritter kan grupperes efter oprindelig kategori |
| Ny tabel `hidden_countries (name TEXT PK)` | Lande brugeren har skjult |

Alle tidsstempler er epoch-millisekunder i `INTEGER`-kolonner, som hidtil.

### Migrering

`migrate()` kan i dag kun oprette tabeller, ikke ændre dem, og appen er allerede installeret med data. Ved opgradering **slettes og genopbygges den lokale database**, hvorefter kanaler og EPG hentes på ny.

Favoritter bevares hen over sletningen: de læses ud før, og skrives ind igen efter. De er det eneste den lokale database indeholder som brugeren selv har skabt.

`PRAGMA user_version` hæves, så fremtidige ændringer kan skelne.

## 10. Kendte risici

| Risiko | Håndtering |
|---|---|
| Landeudledning rammer forkert på sære kategorinavne | Uigenkendte havner under **Øvrige** frem for at forsvinde |
| Mini-preview afvises af 1-forbindelses-panelet | Sekventiel nedlukning, ét genforsøg, forståelig besked, og funktionen kan slås fra |
| Mange små EPG-kald ved scroll | Cache med de tre regler i afsnit 4; kun synlige rækker henter |
| `get_short_epg` findes ikke på alle paneler | Er den utilgængelig, vises "ingen programdata" — kanalliste og afspilning berøres ikke |
| Base64-felter kan være tomme eller beskadigede | Afkodning i core springer poster over uden at kaste, som al anden parsing |

# Sådan bygger Claude fra en ny chat

Læs denne, når du (Claude) starter en ny chat og skal lave et build til
telefonen, fjernsynet eller bilen. Den beskriver den vej der faktisk
virker fra chatten, ikke EAS-vejen i `docs/BUILD.md`, som kræver et
Expo-token og en netværkspolitik chatten ikke har.

## 1. Rammerne

- **Repo og gren:** `Seomidt/norstream`, gren `claude/read-overdragelse-docs-jgous9`,
  PR #1. Alt arbejde committes og pushes dertil. Skift aldrig gren uden at
  brugeren beder om det.
- **Sproget er dansk.** Beskeder til brugeren, commit-beskeder og
  kodekommentarer på dansk. I commit-beskeder og kodekommentarer skrives
  æ/ø/å som ae/oe/aa (fx "laerred", "hoejde"); i tekster brugeren ser i
  appen bruges rigtige æøå. Dokumenter i `docs/` bruger rigtige æøå.
- **Commit-fod:** hver commit slutter med
  `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` og
  `Claude-Session: <link til sessionen>`.
- **Chatten har ikke internet.** Kun `api.github.com` og git-push/pull
  mod GitHub virker. Ingen stream-adresser, ingen radio-browser, ingen
  iTunes kan nås fra chatten. Alt der kræver frit internet køres på GitHub
  med motoren `maal` (afsnit 5). Artefakter (APK'er) kan heller ikke hentes
  til chatten; de tjekkes i workflowet, ikke bagefter.
- **Brugeren kan ikke se dine værktøjskald.** Kun den sidste besked når
  frem. Den skal indeholde linket og hvad brugeren skal gøre og kigge efter.

## 2. Før du bygger

1. `cd /home/user/norstream` i hver kommando; `git add` fra en anden mappe
   har kostet commits uden filer.
2. Typer og test: `npm run typecheck --workspace @norstream/app` (eller
   `npx tsc --noEmit -p .` i `packages/app`), `npx vitest run` i pakken.
   Der er ingen eslint-konfiguration; spring lint over.
3. Tv-ændringer: gennemgå tjeklisten i `docs/ANDROID-TV.md` afsnit 5.
4. Commit og push:
   `git push -u origin claude/read-overdragelse-docs-jgous9`.

## 3. Start bygget

Workflowet er `.github/workflows/build-android.yml`, og det startes med
GitHub-værktøjet fra chatten. Værktøjet skal indlæses først, hver gang
forbindelsen til GitHub-serveren er genstartet:

```
ToolSearch: select:mcp__github__actions_run_trigger,mcp__github__get_job_logs
```

Derefter:

```
mcp__github__actions_run_trigger
  method: run_workflow
  owner: Seomidt
  repo: norstream
  workflow_id: build-android.yml
  ref: claude/read-overdragelse-docs-jgous9
  inputs: <se tabellen>
```

| Mål | `inputs` | Artefakt |
|---|---|---|
| NorStream til telefon | `{"motor":"runner","app":"app","tv":false,"profile":"preview","platform":"android"}` | `norstream-apk` |
| NorStream til Google TV | `{"motor":"runner","app":"app","tv":true,"profile":"preview","platform":"android"}` | `norstream-tv-apk` |
| NorRadio (telefon + Android Auto) | `{"motor":"runner","app":"radio","tv":false,"profile":"preview","platform":"android"}` | `norradio-apk` |
| Måleskript med frit internet | `{"motor":"maal","url":"<navn>","app":"app","profile":"preview","platform":"android"}` | ingen; læs jobloggen |
| Afprøv en adresse i en rigtig browser | `{"motor":"probe","url":"https://…","app":"app","profile":"preview","platform":"android"}` | ingen; læs jobloggen |

`profile` og `platform` er obligatoriske i workflowet, også når motoren
ikke bruger dem. `tv` er en boolean, ikke en streng.

Svaret er kun "queued" uden løbenummer. Find kørslen sådan, 20–30 sekunder
efter:

```bash
curl -s "https://api.github.com/repos/Seomidt/norstream/actions/runs?branch=claude/read-overdragelse-docs-jgous9&event=workflow_dispatch&per_page=1" \
  | grep -E '"(id|run_number|status|html_url)"' | head -4
```

## 4. Følg bygget

Et runner-build tager 7–10 minutter. Kør en løkke i baggrunden i stedet
for at vente i forgrunden:

```bash
id=<run id>
for i in $(seq 1 40); do
  s=$(curl -s https://api.github.com/repos/Seomidt/norstream/actions/runs/$id \
      | grep -E '"(status|conclusion|run_number)"' | head -3 | tr -d ' \n')
  echo "$s"; case "$s" in *completed*) break;; esac; sleep 30
done
```

(`run_in_background: true`, timeout 600000.) Når den melder færdig:

```bash
curl -s https://api.github.com/repos/Seomidt/norstream/actions/runs/$id/artifacts | grep '"name"'
```

Fejler bygget: `mcp__github__get_job_logs` med `run_id`, `failed_only: true`,
`return_content: true`, `tail_lines: 200`. Det er også sådan `maal`- og
`probe`-resultater læses (uden `failed_only`; find job-id via
`…/actions/runs/$id/jobs`).

## 5. Måleskripter (`motor: maal`)

Til alt der kræver internet: "sender stationen ICY-titler?", "findes der
en 320 kbps-stream?", "hvilke logoer mangler?". Skriv et Node-skript i
`scripts/maal/<navn>.mjs` (ren Node 20, ingen pakker, `fetch` med
timeouts på alt), commit, og kør det med `motor: maal` og `url: <navn>`.
Skriptet skriver til stdout; læs jobloggen. Eksempler: `icy.mjs`,
`dkstreams.mjs`, `partyfm.mjs`, `radiologoer.mjs`, `drhls.mjs`.

**Brug aldrig rigtige legitimationsoplysninger i et måleskript.** Loggen
er synlig for alle med adgang til repoet. Probes bruger testlegitimation.

## 6. Hvad brugeren skal have at vide

Skriv altid:

1. Byggets løbenummer og link: `https://github.com/Seomidt/norstream/actions/runs/<id>`.
2. "Rul ned til Artifacts og hent `<artefaktnavn>`." Zip-filen pakkes ud,
   og APK'en åbnes på enheden.
3. Hvad der er nyt i bygget, i almindeligt sprog, uden filnavne.
4. Hvad brugeren skal prøve, og hvad et foto skal vise.

Installation:

- **Telefon:** åbn APK'en; Android beder om "ukendte kilder" første gang.
  Opgradering ovenpå virker, signaturen er den samme for alle runner-builds.
- **Google TV Streamer:** se `docs/ANDROID-TV.md` afsnit 2 ("Send files to TV").
- **Android Auto (NorRadio):** appen skal være installeret på telefonen, og
  "Ukendte kilder" skal være slået til i Android Autos udviklerindstillinger.
  Bilen viser først en ny liste efter at telefonen er koblet fra og til
  igen. Appen har en skjult logside: hold fingeren på titlen på forsiden.
  Den viser hvad bilen har bedt om, og har kontakten "Sang og cover i bilen".

## 7. Sikkerhed, som gælder hver gang

- **Vis aldrig en rå afspilningsfejl eller stream-adresse** til brugeren
  eller i en log: adressen indeholder panelets adgangskode. Appen viser
  kun "Streamen kunne ikke afspilles".
- **Ingen rigtige legitimationsoplysninger i CI-logs, skripter, commits eller
  chatten.** Har brugeren indsat et token i chatten, så bed om at få det
  ombyttet. Expo-tokenet ligger som secret `EXPO` i repoet.
- Sikkerhedskopifilen fra appen indeholder API-nøgler i klartekst.
  Brugeren er advaret; skriv den aldrig ind i et dokument.

## 8. Fejl der er set i workflowet

| Symptom | Årsag | Rettelse |
|---|---|---|
| `GetEnv.NoBoolean` i prebuild | `EXPO_TV` var tom | Workflowet sætter `'1'`/`'0'`; rør det ikke |
| "LEANBACK_LAUNCHER mangler" | tv-plugin kørte ikke | Tjek `tv: true` blev sendt som boolean |
| Bygget lykkes, men rettelsen er ikke med | Pushet nåede ikke grenen, eller `git add` fra forkert mappe | `git log origin/<gren> -1` før du starter bygget |
| Node 20 deprecation-advarsler | gamle actions | Opdateret til setup-java@v5, cache@v5, upload-artifact@v6 |
| `maal` hænger | et `fetch` uden timeout mod en stream | AbortController med timeout på alle kald |

## 9. Seneste referencebuilds (september 2026)

| Hvad | Nummer | Link |
|---|---|---|
| NorStream tv | 204 | https://github.com/Seomidt/norstream/actions/runs/34708734583 |
| NorStream telefon | 196 | https://github.com/Seomidt/norstream/actions/runs/34695344602 |
| NorRadio | 198 (197 fejlede paa to Kotlin-linjer, rettet) | se Actions paa branchen |

Åbne punkter, som en ny chat kan blive spurgt om: Android Auto ruller til
toppen af listen få sekunder efter start (uafklaret; gearhead beder selv
om `getChildren` igen), Google Play-udgivelse (AAB + signering) og
Apple TV via EAS.

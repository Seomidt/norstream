# @uhf-play/core

Platformsuafhængigt TypeScript-bibliotek: parser M3U-playlister og XMLTV-EPG,
taler med et Xtream Codes-panel og bygger stream-URL'er. Ingen
runtime-dependencies, ingen Node- eller React Native-specifikke imports —
kan bruges direkte af en React Native-app eller enhver anden JS-runtime.

## Offentligt API (se `src/index.ts`)

- **Modeller**: `Channel`, `Category`, `Programme`, `XtreamCredentials`,
  `StreamFormat`, `TimeshiftDialect`.
- **M3U**: `parseM3u(text)` → `M3uEntry[]`. Kaster aldrig; ugyldige poster
  udelades.
- **XMLTV**: `createXmltvParser(onProgramme)` — streamet parser til vilkårligt
  store dokumenter, fodres med `write(chunk)` og afsluttes med `end()`.
  `parseXmltvTimestamp(value)` og `decodeXmlEntities(text)` er de underliggende
  byggeklodser. Ugyldige `<programme>`-elementer springes over uden at kaste.
- **Xtream**: `XtreamClient` (autentificering, kanal- og kategorilister),
  `mapChannel(s)`/`mapCategory(-ies)` (rå JSON → domænemodeller),
  `detectTimeshiftDialect` (afgør om panelet taler `php`- eller
  `path`-dialekten for start-forfra).
- **URL'er**: `buildLiveUrl`, `buildTimeshiftUrl`, `buildXmltvUrl`,
  `formatTimeshiftStart`, `normaliseBaseUrl`.

`XtreamClient` er den bevidste undtagelse fra "kaster aldrig": transportfejl
(netværk, HTTP-status, ugyldig JSON, ugyldigt listesvar) kaster typede fejl —
`XtreamAuthError` (credentials afvist, ryd keychain) eller
`XtreamNetworkError` (panelet kunne ikke nås/forstås, fald tilbage på cache).

## `FetchLike` og timeout

`XtreamClient` og `detectTimeshiftDialect` tager en injiceret `FetchLike`
(`(url: string) => Promise<FetchLikeResponse>`) i stedet for at bruge et
globalt `fetch`. **`core` sætter ingen timeout selv** — det er den
konsumerende apps ansvar at give en `FetchLike`-implementering, der afbryder
langsomme kald (fx via `AbortController` eller et bibliotek med indbygget
timeout). Uden det kan et kald mod et dødt panel hænge for evigt.

## Join-nøglen: `Channel.epgChannelId` ↔ `Programme.channelId`

En kanal fra M3U eller Xtream (`Channel.epgChannelId`) og et EPG-program fra
XMLTV (`Programme.channelId`) hænger sammen via denne strengsammenligning —
der er ingen anden kobling. Begge værdier er allerede afkodede/utrimmede rene
strenge (XML-entiteter i XMLTV-attributter afkodes af parseren), så
sammenligningen kan ske direkte uden yderligere normalisering. Er
`epgChannelId` `null`, findes der ingen EPG-data for kanalen.

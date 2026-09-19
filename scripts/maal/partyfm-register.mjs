// Hvad staar der om PartyFM i registret, og virker hver af adresserne?
// Baggrund: alle mounts paa stream.partyfm.dk svarer 200, men stationen
// "virker ikke mere" i appen. Mistanke: dedupen vaelger en registerpost med
// en doed adresse (stream1.partyfm.dk svarer 404 paa alt).
const API = 'https://de1.api.radio-browser.info/json';
const UA = 'NorStream/1.0 (Android; +https://github.com/Seomidt/norstream)';
const get = async (url, ms = 8000) => {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try {
    return await fetch(url, { headers: { 'user-agent': UA, 'Icy-MetaData': '1' }, signal: c.signal });
  } finally {
    clearTimeout(t);
  }
};
const r = await get(`${API}/stations/search?name=party&countrycode=DK&hidebroken=false&limit=50`);
const list = await r.json();
console.log(`${list.length} poster i registret med "party" i navnet (DK)\n`);
for (const s of list) {
  console.log(`- ${s.name}`);
  console.log(`  uuid=${s.stationuuid} votes=${s.votes} bitrate=${s.bitrate} codec=${s.codec} lastcheckok=${s.lastcheckok} lastchecktime=${s.lastchecktime}`);
  console.log(`  url=${s.url}`);
  console.log(`  url_resolved=${s.url_resolved}`);
  for (const u of new Set([s.url, s.url_resolved].filter(Boolean))) {
    try {
      const p = await get(u);
      console.log(`  -> ${p.status} ${p.headers.get('content-type') ?? ''} br=${p.headers.get('icy-br') ?? ''} ${u}`);
      await p.body?.cancel();
    } catch (e) {
      console.log(`  -> FEJL ${e?.name ?? e} ${u}`);
    }
  }
}
// Samme opslag som appen laver for hele landet: hvilken PartyFM-post overlever dedupen?
const all = await (await get(`${API}/stations/bycountrycodeexact/DK?hidebroken=true&order=votes&reverse=true&limit=2000`, 20000)).json();
const party = all.filter((s) => /party/i.test(s.name));
console.log(`\nI landelisten (hidebroken=true, sorteret efter stemmer): ${party.length} PartyFM-poster i den raekkefoelge appen ser dem:`);
for (const s of party) console.log(`  ${String(s.votes).padStart(5)} stemmer  ${String(s.bitrate).padStart(3)} kbit  ${s.name}  ${s.url_resolved || s.url}`);

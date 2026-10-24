// Kan trailere hentes fra IMDb i stedet for YouTube? IMDb udleverer sine
// trailere som almindelige videofiler (op til 1080p) til enhver browser, uden
// robot-bevis. Proever baade IMDbs offentlige GraphQL (som deres egen side
// bruger) og titelsiden. Adresser forkortes i udskriften.

const TITLES = [
  ['Dune: Part Two', 'tt15239678'],
  ['Oppenheimer', 'tt15398776'],
  ['Tuner', 'tt23150032'],
];
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const short = (u) => (u ? `${new URL(u).host}/…${new URL(u).pathname.slice(-24)}` : '-');

const QUERY = `query T($id: ID!) { title(id: $id) { titleText { text } primaryVideos(first: 5) { edges { node { id name { value } runtime { value } contentType { displayName { value } } playbackURLs { displayName { value } videoMimeType url } } } } } }`;

async function graphql(id) {
  const r = await fetch('https://api.graphql.imdb.com/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': UA, 'x-imdb-client-name': 'imdb-web-next', 'Accept-Language': 'en-US' },
    body: JSON.stringify({ query: QUERY, variables: { id } }),
  });
  const text = await r.text();
  try {
    return { status: r.status, json: JSON.parse(text) };
  } catch {
    return { status: r.status, json: null, head: text.slice(0, 120) };
  }
}

async function range(url, from, to) {
  const r = await fetch(url, { headers: { 'User-Agent': 'ExoPlayerLib/1.4.1', Range: `bytes=${from}-${to}` } });
  const len = r.headers.get('content-range');
  await r.arrayBuffer();
  return `${r.status} ${len ?? ''}`;
}

for (const [label, id] of TITLES) {
  console.log(`\n=== ${label} (${id})`);
  const g = await graphql(id);
  console.log(`  graphql http=${g.status}${g.head ? ` krop="${g.head}"` : ''}${g.json?.errors ? ` fejl=${JSON.stringify(g.json.errors).slice(0, 160)}` : ''}`);
  const edges = g.json?.data?.title?.primaryVideos?.edges ?? [];
  for (const { node } of edges) {
    const urls = node.playbackURLs ?? [];
    console.log(`  ${node.id} "${node.name?.value}" ${node.contentType?.displayName?.value ?? ''} ${node.runtime?.value ?? '?'}s: ${urls.map((u) => `${u.displayName?.value}/${u.videoMimeType}`).join(', ')}`);
  }
  const first = edges[0]?.node;
  const mp4 = (first?.playbackURLs ?? []).filter((u) => u.videoMimeType === 'MP4').sort((a, b) => parseInt(b.displayName?.value) - parseInt(a.displayName?.value))[0];
  const hls = (first?.playbackURLs ?? []).find((u) => u.videoMimeType === 'M3U8');
  if (mp4) {
    console.log(`  bedste mp4 ${mp4.displayName?.value} ${short(mp4.url)}: start ${await range(mp4.url, 0, 65535)}`);
    const head = await fetch(mp4.url, { method: 'HEAD', headers: { 'User-Agent': 'ExoPlayerLib/1.4.1' } });
    const size = Number(head.headers.get('content-length'));
    console.log(`  stoerrelse ${size} bytes; slutningen: ${size > 0 ? await range(mp4.url, size - 65536, size - 1) : '?'}`);
    const t0 = Date.now();
    const all = await fetch(mp4.url, { headers: { 'User-Agent': 'ExoPlayerLib/1.4.1' } });
    const bytes = (await all.arrayBuffer()).byteLength;
    console.log(`  hele filen: ${all.status} ${bytes} bytes paa ${Date.now() - t0} ms`);
  }
  if (hls) console.log(`  hls ${short(hls.url)}: ${(await fetch(hls.url, { headers: { 'User-Agent': 'ExoPlayerLib/1.4.1' } })).status}`);
  // Titelsiden som reserve: er den spaerret (fx AWS-udfordring)?
  const page = await fetch(`https://www.imdb.com/title/${id}/`, { headers: { 'User-Agent': UA, 'Accept-Language': 'en-US' } });
  const html = await page.text();
  console.log(`  titelside http=${page.status} ${html.length} tegn, video-id'er: ${[...new Set(html.match(/vi\d{8,}/g) ?? [])].slice(0, 3).join(' ')}`);
}

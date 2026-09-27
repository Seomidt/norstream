// Apple TV (uts): hvordan er soegesvaret og filmsiden bygget op? Hvor ligger
// trailerne (hls-adresser), med hvilke navne/laengder/typer? Kun strukturen
// udskrives; adresser forkortes.
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
const BASE = 'https://tv.apple.com/api/uts/v3';
const P = { utscf: 'OjAAAAAAAAA~', utsk: '6e3013c6d6fae3c2::::::235656c069bb0efb', caller: 'web', sf: '143441', v: '68', pfm: 'web', locale: 'en-US' };
const q = (extra) => new URLSearchParams({ ...P, ...extra }).toString();
const get = async (url) => (await fetch(url, { headers: { 'User-Agent': UA, Origin: 'https://tv.apple.com' } })).json();

function walk(node, path, out) {
  if (Array.isArray(node)) node.forEach((v, i) => walk(v, `${path}[${i}]`, out));
  else if (node && typeof node === 'object') for (const [k, v] of Object.entries(node)) walk(v, `${path}.${k}`, out);
  else if (typeof node === 'string' && node.includes('.m3u8')) out.push(path);
}

for (const term of ['Oppenheimer', 'Dune Part Two', 'Druk']) {
  const s = await get(`${BASE}/search?${q({ searchTerm: term })}`);
  const shelves = s.data?.canvas?.shelves ?? [];
  console.log(`\n=== soeg "${term}": hylder ${shelves.map((h) => `${h.id}(${h.items?.length})`).join(' ')}`);
  const items = shelves.flatMap((h) => h.items ?? []);
  for (const it of items.slice(0, 4)) console.log(`  ${it.id} type=${it.type} "${it.title}" udgivet=${it.releaseDate ? new Date(it.releaseDate).getUTCFullYear() : '?'} noegler=${Object.keys(it).slice(0, 14).join(',')}`);
  const movie = items.find((it) => it.type === 'Movie');
  if (!movie) continue;
  const d = await get(`${BASE}/movies/${movie.id}?${q({})}`);
  const paths = [];
  walk(d, 'd', paths);
  console.log(`  film ${movie.id}: topnoegler data=${Object.keys(d.data ?? {}).join(',')}`);
  console.log(`  m3u8-stier (${paths.length}):`);
  for (const p of paths.slice(0, 8)) console.log(`    ${p}`);
  // Naboerne til den foerste trailer: gaa to niveauer op og vis felter.
  if (paths[0]) {
    const parts = paths[0].replace(/^d/, '').match(/\.[^.[\]]+|\[\d+\]/g) ?? [];
    let node = d;
    const trail = [];
    for (const part of parts) {
      trail.push(node);
      node = part.startsWith('[') ? node[Number(part.slice(1, -1))] : node[part.slice(1)];
    }
    for (const up of [trail.at(-1), trail.at(-2), trail.at(-3), trail.at(-4)]) {
      if (up && typeof up === 'object' && !Array.isArray(up)) {
        const summary = Object.fromEntries(Object.entries(up).map(([k, v]) => [k, typeof v === 'object' ? (Array.isArray(v) ? `[${v.length}]` : '{…}') : String(v).slice(0, 50)]));
        console.log(`    niveau: ${JSON.stringify(summary)}`);
      }
    }
  }
}

// Finder Apple TV's soegning flere film (ikke kun Apple TV+) med en anden
// butik (DK), sprog eller version? Og kan en iTunes-film som Oppenheimer
// findes via dens egen side paa tv.apple.com?
const BASE = 'https://tv.apple.com/api/uts/v3';
const common = { utscf: 'OjAAAAAAAAA~', utsk: '6e3013c6d6fae3c2::::::235656c069bb0efb', caller: 'web', pfm: 'web' };
const VARIANTS = [
  ['US v68', { sf: '143441', v: '68', locale: 'en-US' }],
  ['US v90', { sf: '143441', v: '90', locale: 'en-US' }],
  ['DK v68 da', { sf: '143458', v: '68', locale: 'da-DK' }],
  ['DK v68 en', { sf: '143458', v: '68', locale: 'en-GB' }],
  ['GB v68', { sf: '143444', v: '68', locale: 'en-GB' }],
];
const get = async (u) => {
  const r = await fetch(u, { headers: { Origin: 'https://tv.apple.com' } });
  const t = await r.text();
  try {
    return { status: r.status, json: JSON.parse(t) };
  } catch {
    return { status: r.status, json: null };
  }
};
for (const term of ['Oppenheimer', 'Dune: Part Two', 'Another Round', 'Druk', 'Gladiator II']) {
  console.log(`\n=== "${term}"`);
  for (const [label, extra] of VARIANTS) {
    const { status, json } = await get(`${BASE}/search?${new URLSearchParams({ ...common, ...extra, searchTerm: term })}`);
    const movies = (json?.data?.canvas?.shelves ?? []).flatMap((s) => s.items ?? []).filter((i) => i.type === 'Movie');
    const titles = [...new Set(movies.map((m) => m.title))].slice(0, 4);
    console.log(`  ${label.padEnd(10)} http=${status} film: ${titles.join(' | ') || '-'}`);
  }
}
// Oppenheimers side paa tv.apple.com (fundet via en soegemaskine-venlig adresse?)
const page = await fetch('https://tv.apple.com/us/search?term=oppenheimer');
const html = await page.text();
const ids = [...new Set(html.match(/umc\.cmc\.[a-z0-9]{20,}/g) ?? [])].slice(0, 5);
console.log(`\nsoegeside http=${page.status} ${html.length} tegn, id'er: ${ids.join(' ')}`);

// Hvorfor gav Oppenheimer, Dune: Part Two og Another Round 0 trailere hos
// Apple TV? Vis soegesvarets film (titel, type, udgivelse) og filmsidens
// trailer-felter. Og: hvilke lydcodecs findes i hovedmanifestet?
const BASE = 'https://tv.apple.com/api/uts/v3';
const P = { utscf: 'OjAAAAAAAAA~', utsk: '6e3013c6d6fae3c2::::::235656c069bb0efb', caller: 'web', sf: '143441', v: '68', pfm: 'web', locale: 'en-US' };
const q = (e = {}) => new URLSearchParams({ ...P, ...e }).toString();
const get = async (u) => (await fetch(u, { headers: { Origin: 'https://tv.apple.com' } })).json();

for (const term of ['Oppenheimer', 'Dune: Part Two', 'Dune Part Two', 'Another Round', 'Napoleon']) {
  const s = await get(`${BASE}/search?${q({ searchTerm: term })}`);
  console.log(`\n=== "${term}"`);
  for (const shelf of s.data?.canvas?.shelves ?? []) {
    const items = (shelf.items ?? []).filter((i) => i.type === 'Movie').slice(0, 6);
    if (items.length) console.log(`  ${shelf.id}: ${items.map((i) => `"${i.title}" ${i.releaseDate ? new Date(i.releaseDate).toISOString().slice(0, 10) : 'ingen-dato'} ${i.id.slice(-6)}`).join(' | ')}`);
  }
  const movie = (s.data?.canvas?.shelves ?? []).flatMap((h) => h.items ?? []).find((i) => i.type === 'Movie' && i.title?.toLowerCase().includes(term.split(/[: ]/)[0].toLowerCase()));
  if (!movie) continue;
  const d = await get(`${BASE}/movies/${movie.id}?${q()}`);
  const shelves = d.data?.canvas?.shelves ?? [];
  console.log(`  side "${movie.title}": hylder ${shelves.map((h) => `${h.id ?? h.title}(${h.items?.length})`).join(' ')}`);
  for (const shelf of shelves) {
    for (const it of (shelf.items ?? []).slice(0, 4)) {
      const pl = it.playables?.[0];
      console.log(`    ${shelf.id ?? '?'}: "${it.title}" localizedType=${it.localizedType} type=${it.type} duration=${pl?.duration} hls=${Boolean(pl?.assets?.hlsUrl)}`);
    }
  }
  const clip = Object.values(d.data?.playables ?? {})[0]?.itunesMediaApiData?.movieClips?.[0];
  if (clip) console.log(`  movieClips[0]: noegler=${Object.keys(clip).join(',')}`);
  const hls = shelves.flatMap((h) => h.items ?? []).find((i) => i.playables?.[0]?.assets?.hlsUrl)?.playables[0].assets.hlsUrl ?? clip?.hlsUrl;
  if (hls) {
    const m = await (await fetch(hls)).text();
    const codecs = [...new Set((m.match(/CODECS="[^"]+"/g) ?? []))];
    const audioGroups = [...new Set((m.match(/TYPE=AUDIO,GROUP-ID="[^"]+"/g) ?? []))];
    console.log(`  codecs: ${codecs.join(' ')}`);
    console.log(`  lydgrupper: ${audioGroups.join(' ')}`);
  }
}

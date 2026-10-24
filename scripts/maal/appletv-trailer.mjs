// Apple TV's hjemmeside (tv.apple.com) viser trailere uden login. Hvilken
// tjeneste bruger den, kan den soeges, og er trailerne almindelig HLS (ikke
// kopibeskyttet) i hvilken kvalitet? Adresser forkortes i udskriften.

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
const short = (u) => {
  try {
    const x = new URL(u);
    return `${x.host}${x.pathname.slice(0, 40)}…`;
  } catch {
    return String(u).slice(0, 60);
  }
};

// 1) Siden: hvilke API-adresser og parametre bruger den?
const page = await fetch('https://tv.apple.com/us/room/movies-on-appletv/edt.item.6454f7d8-98d5-4c09-95a6-b4606de32cc2', { headers: { 'User-Agent': UA } });
const html = await page.text();
console.log(`side http=${page.status} ${html.length} tegn`);
const utsk = /utsk["'=:\s]+["']?([0-9a-f]{8,}[^"'&\s]*)/i.exec(html)?.[1] ?? null;
const utscf = /utscf["'=:\s]+["']?([A-Za-z0-9~_-]{6,})/i.exec(html)?.[1] ?? null;
const v = /[?&]v=(\d{2,3})/.exec(html)?.[1] ?? null;
const apis = [...new Set(html.match(/https?:\/\/[a-z.]*apple\.com\/api\/uts\/v\d\/[a-z/]+/gi) ?? [])].slice(0, 5);
console.log(`utsk=${utsk ? 'fundet' : 'nej'} utscf=${utscf ?? 'nej'} v=${v ?? 'nej'} api=${apis.join(' ') || 'ingen i html'}`);
const hlsInPage = [...new Set(html.match(/https:\/\/[a-z.-]+\.apple\.com\/[^"'\s]+\.m3u8[^"'\s]*/gi) ?? [])];
console.log(`m3u8 i siden: ${hlsInPage.length}${hlsInPage[0] ? ` fx ${short(hlsInPage[0])}` : ''}`);

// 2) Soegning via uts, med kendte web-parametre (fra siden hvis muligt).
const params = new URLSearchParams({
  searchTerm: 'Oppenheimer',
  utscf: utscf ?? 'OjAAAAAAAAA~',
  utsk: utsk ?? '6e3013c6d6fae3c2::::::235656c069bb0efb',
  caller: 'web',
  sf: '143441',
  v: v ?? '68',
  pfm: 'web',
  locale: 'en-US',
});
for (const base of ['https://tv.apple.com/api/uts/v3/search', 'https://uts-api.itunes.apple.com/uts/v3/search']) {
  const r = await fetch(`${base}?${params}`, { headers: { 'User-Agent': UA, Origin: 'https://tv.apple.com' } });
  const text = await r.text();
  console.log(`\nsoeg ${short(base)} http=${r.status} ${text.slice(0, 200).replace(/\s+/g, ' ')}`);
  let d = null;
  try {
    d = JSON.parse(text);
  } catch {
    continue;
  }
  const json = JSON.stringify(d);
  const ids = [...new Set(json.match(/umc\.cmc\.[a-z0-9]+/g) ?? [])].slice(0, 5);
  const m3u8 = [...new Set(json.match(/https:\\?\/\\?\/[^"]+\.m3u8[^"]*/g) ?? [])].map((u) => u.replace(/\\\//g, '/'));
  console.log(`  id'er: ${ids.join(' ')}; m3u8 i svaret: ${m3u8.length}`);
  const first = ids[0];
  if (first) {
    const pr = new URLSearchParams(params);
    pr.delete('searchTerm');
    const detail = await fetch(`${base.replace('/search', '')}/movies/${first}?${pr}`, { headers: { 'User-Agent': UA, Origin: 'https://tv.apple.com' } });
    const dt = await detail.text();
    const links = [...new Set(dt.match(/https:\\?\/\\?\/[^"]+\.m3u8[^"]*/g) ?? [])].map((u) => u.replace(/\\\//g, '/'));
    console.log(`  film ${first}: http=${detail.status} ${dt.length} tegn, m3u8: ${links.length}`);
    for (const link of links.slice(0, 2)) {
      const m = await fetch(link, { headers: { 'User-Agent': 'ExoPlayerLib/1.4.1' } });
      const body = await m.text();
      const res = [...new Set(body.match(/RESOLUTION=\d+x\d+/g) ?? [])].join(' ');
      const drm = /EXT-X-KEY|EXT-X-SESSION-KEY|skd:\/\/|com\.apple\.streamingkeydelivery/i.test(body);
      console.log(`    ${short(link)} http=${m.status} kopibeskyttet=${drm} ${res}`);
      const variant = body.split('\n').find((l) => l && !l.startsWith('#'));
      if (variant) {
        const vu = new URL(variant, link).href;
        const vb = await (await fetch(vu, { headers: { 'User-Agent': 'ExoPlayerLib/1.4.1' } })).text();
        const vdrm = /EXT-X-KEY:METHOD=(?!NONE)|skd:\/\//i.test(vb);
        console.log(`    variant kopibeskyttet=${vdrm}; stykker=${vb.split('\n').filter((l) => l && !l.startsWith('#')).length}`);
      }
    }
  }
}

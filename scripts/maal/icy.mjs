// Sender radiostationerne "hvad der spilles nu" med i streamen?
//
// Icecast/Shoutcast kan sende ICY-metadata: en tekstlinje ("StreamTitle")
// hvert icy-metaint. byte, typisk "Kunstner - Titel". Der er aldrig et
// billede med. Her aabnes de mest stemte danske stationer med
// Icy-MetaData: 1, den foerste tekstlinje laeses, og for dem der har en
// slaas et cover op paa iTunes og Deezer ud fra teksten.
const UA = 'NorStream/1.0 (Android; +https://github.com/Seomidt/norstream)';

async function icyTitle(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch(url, { headers: { 'user-agent': UA, 'Icy-MetaData': '1' }, redirect: 'follow', signal: controller.signal });
    const metaint = Number(res.headers.get('icy-metaint') ?? 0);
    const type = res.headers.get('content-type') ?? '';
    const name = res.headers.get('icy-name') ?? '';
    if (!res.body) return { type, metaint, name, title: null, note: 'ingen krop' };
    if (metaint <= 0) {
      await res.body.cancel();
      return { type, metaint, name, title: null, note: type.includes('mpegurl') ? 'HLS (evt. ID3-metadata i segmenter)' : 'ingen icy-metaint' };
    }
    const reader = res.body.getReader();
    let buf = Buffer.alloc(0);
    // To blokke: den foerste kan vaere tom (laengde 0) indtil naeste sang.
    const need = metaint * 2 + 2 + 4080;
    while (buf.length < need) {
      const { value, done } = await reader.read();
      if (done) break;
      buf = Buffer.concat([buf, Buffer.from(value)]);
    }
    await reader.cancel().catch(() => undefined);
    let title = null;
    let pos = metaint;
    for (let i = 0; i < 2 && pos < buf.length; i++) {
      const len = buf[pos] * 16;
      const text = buf.subarray(pos + 1, pos + 1 + len).toString('utf8').replace(/\0+$/, '');
      const m = /StreamTitle='([^']*)'/.exec(text);
      if (m && m[1].length > 0) { title = m[1]; break; }
      pos = pos + 1 + len + metaint;
    }
    return { type, metaint, name, title, note: title === null ? 'tom titel i de foerste blokke' : '' };
  } catch (e) {
    return { type: '', metaint: 0, name: '', title: null, note: String(e?.name ?? e) };
  } finally {
    clearTimeout(timer);
  }
}

async function cover(title) {
  const q = encodeURIComponent(title.replace(/\s+-\s+/g, ' '));
  const out = [];
  try {
    const r = await fetch(`https://itunes.apple.com/search?term=${q}&entity=song&limit=1`, { headers: { 'user-agent': UA } });
    const j = await r.json();
    const hit = j.results?.[0];
    out.push(hit ? `itunes: ${hit.artistName} – ${hit.trackName} ${hit.artworkUrl100 ? '(cover ja)' : '(intet cover)'}` : `itunes: intet (status ${r.status})`);
  } catch (e) { out.push(`itunes: fejl ${e?.name ?? e}`); }
  try {
    const r = await fetch(`https://api.deezer.com/search?q=${q}&limit=1`, { headers: { 'user-agent': UA } });
    const j = await r.json();
    const hit = j.data?.[0];
    out.push(hit ? `deezer: ${hit.artist?.name} – ${hit.title} ${hit.album?.cover_medium ? '(cover ja)' : '(intet cover)'}` : `deezer: intet (status ${r.status})`);
  } catch (e) { out.push(`deezer: fejl ${e?.name ?? e}`); }
  return out.join(' | ');
}

const r = await fetch('https://de1.api.radio-browser.info/json/stations/bycountrycodeexact/dk?limit=14&order=votes&reverse=true&hidebroken=true', { headers: { 'user-agent': UA } });
const stations = await r.json();
let withTitle = 0;
for (const s of stations) {
  const url = s.url_resolved || s.url;
  const info = await icyTitle(url);
  console.log(`${s.name.slice(0, 24).padEnd(24)} type=${info.type.slice(0, 18).padEnd(18)} metaint=${String(info.metaint).padEnd(6)} titel=${info.title === null ? '-' : JSON.stringify(info.title)} ${info.note}`);
  if (info.title !== null && /\S\s+-\s+\S/.test(info.title)) {
    withTitle++;
    console.log(`    ${await cover(info.title)}`);
  }
}
console.log(`\n${withTitle} af ${stations.length} sendte en "Kunstner - Titel"-linje.`);

// Hvor mange radiostationer mangler logo, og hvor kan et hentes i stedet?
//
// Radio Browser giver mange stationer uden favicon. De fleste har en
// hjemmeside, og der findes tjenester der giver et ikon for et domaene.
// Her maales for nogle lande: andelen uden favicon, andelen af dem med
// hjemmeside, og for et udsnit hvad Googles, DuckDuckGos og hjemmesidens
// egen /favicon.ico svarer — status, type, stoerrelse, og om Google bare
// gav sin graa standardklode (samme bytes for alle ukendte domaener).
import { createHash } from 'node:crypto';

const UA = 'NorStream/1.0 (Android; +https://github.com/Seomidt/norstream)';
const COUNTRIES = ['dk', 'se', 'no', 'de', 'gb', 'us', 'fi', 'nl'];

async function get(url, ms = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, { headers: { 'user-agent': UA }, redirect: 'follow', signal: controller.signal });
    const buf = Buffer.from(await res.arrayBuffer());
    return { status: res.status, type: res.headers.get('content-type') ?? '', bytes: buf.length, hash: createHash('sha1').update(buf).digest('hex').slice(0, 8), buf };
  } catch (e) {
    return { status: 0, type: String(e?.name ?? e), bytes: 0, hash: '-', buf: null };
  } finally {
    clearTimeout(timer);
  }
}

function pngSize(buf) {
  if (!buf || buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) return '';
  return `${buf.readUInt32BE(16)}x${buf.readUInt32BE(20)}`;
}

const host = (homepage) => { try { return new URL(homepage).hostname.replace(/^www\./, ''); } catch { return null; } };

const sample = [];
for (const c of COUNTRIES) {
  const r = await get(`https://de1.api.radio-browser.info/json/stations/bycountrycodeexact/${c}?limit=300&order=votes&reverse=true&hidebroken=true`);
  if (r.status !== 200) { console.log(`${c}: Radio Browser svarede ${r.status}`); continue; }
  const list = JSON.parse(r.buf.toString());
  const noFav = list.filter((s) => !/^https?:\/\//i.test(s.favicon ?? ''));
  const withHome = noFav.filter((s) => host(s.homepage ?? ''));
  console.log(`${c}: ${list.length} stationer, ${noFav.length} uden favicon, ${withHome.length} af dem har hjemmeside`);
  for (const s of withHome.slice(0, 4)) sample.push({ c, name: s.name, host: host(s.homepage) });
}

// Googles standardklode: bed om et domaene der ikke findes.
const globe = await get('https://www.google.com/s2/favicons?domain=denne-findes-ikke-987654.dk&sz=128');
console.log(`\nGoogle standardklode: status=${globe.status} bytes=${globe.bytes} hash=${globe.hash} ${pngSize(globe.buf)}`);

console.log('\nUdsnit af stationer uden favicon (google sz=128 | ddg ip3 | /favicon.ico):');
let gOk = 0, dOk = 0, fOk = 0;
for (const s of sample) {
  const g = await get(`https://www.google.com/s2/favicons?domain=${s.host}&sz=128`);
  const d = await get(`https://icons.duckduckgo.com/ip3/${s.host}.ico`);
  const f = await get(`https://${s.host}/favicon.ico`);
  const gReal = g.status === 200 && g.hash !== globe.hash;
  if (gReal) gOk++;
  if (d.status === 200 && d.bytes > 0) dOk++;
  if (f.status === 200 && f.bytes > 0 && /image/i.test(f.type)) fOk++;
  console.log(
    `${s.c} ${s.name.slice(0, 26).padEnd(26)} ${s.host.padEnd(28)} google=${g.status}/${g.bytes}b/${pngSize(g.buf) || g.type.slice(0, 12)}${gReal ? '' : ' (klode)'}` +
      ` | ddg=${d.status}/${d.bytes}b | favicon.ico=${f.status}/${f.bytes}b/${f.type.slice(0, 20)}`,
  );
}
console.log(`\nAf ${sample.length}: google rigtigt ikon ${gOk}, ddg ${dOk}, egen favicon.ico ${fOk}`);

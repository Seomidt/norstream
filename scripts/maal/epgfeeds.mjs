// Hvilke offentlige XMLTV-feeds for DK/UK/US virker, hvor store er de (pakket og
// upakket), og hvor mange kanaler/programmer har de? Koeres med motoren "maal"
// (frit internet). Ingen legitimation — alt er offentlige feeds. Bruges til at
// vaelge feeds appen kan klare (40 MB upakket-graense) og til .gz-stoetten.
import { gunzipSync } from 'node:zlib';

const UA =
  'Mozilla/5.0 (Linux; Android 12; NorStream) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

// Foerst: hvad hedder epgshare01's US-filer overhovedet? US1 gav 404, saa
// listen er skiftet. Vi henter mappeoversigten og trekker US-.gz-navnene ud.
async function discoverEpgshare01Us() {
  const r = await get('https://epgshare01.online/epgshare01/');
  if (r.status !== 200) {
    console.log(`\n# epgshare01 index status=${r.status} error=${r.error ?? ''}`);
    return [];
  }
  const html = r.buf.toString('utf8');
  const files = [...html.matchAll(/href="([^"]*epg_ripper_US[^"]*\.xml\.gz)"/gi)].map((m) => m[1]);
  const uniq = [...new Set(files)].map((f) => (f.startsWith('http') ? f : `https://epgshare01.online/epgshare01/${f.replace(/^.*\//, '')}`));
  console.log(`\n# epgshare01 US-filer fundet: ${uniq.length}`);
  for (const u of uniq) console.log(`  - ${u}`);
  return uniq;
}

const BASE = [
  // Passer allerede — med til sammenligning
  'https://epgshare01.online/epgshare01/epg_ripper_DK1.xml.gz',
  'https://epgshare01.online/epgshare01/epg_ripper_UK1.xml.gz',
  'https://epg.pw/xmltv/epg_GB.xml.gz',
  // US-kandidater der maaske er en brugbar delmaengde (ikke hele 156 MB)
  'https://i.mjh.nz/PlutoTV/us.xml.gz',
  'https://i.mjh.nz/SamsungTVPlus/us.xml.gz',
  'https://i.mjh.nz/Plex/us.xml.gz',
  'https://i.mjh.nz/Roku/us.xml.gz',
];

async function get(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45000);
  try {
    const r = await fetch(url, { headers: { 'user-agent': UA, accept: '*/*' }, signal: controller.signal, redirect: 'follow' });
    const buf = Buffer.from(await r.arrayBuffer());
    return { status: r.status, type: r.headers.get('content-type') ?? '', buf, finalUrl: r.url };
  } catch (e) {
    return { status: 0, type: '', buf: Buffer.alloc(0), error: String(e && e.message ? e.message : e) };
  } finally {
    clearTimeout(timer);
  }
}

function summarise(xml) {
  const channels = (xml.match(/<channel\b/gi) ?? []).length;
  const programmes = (xml.match(/<programme\b/gi) ?? []).length;
  const names = [...xml.matchAll(/<display-name[^>]*>([\s\S]*?)<\/display-name>/gi)]
    .slice(0, 4)
    .map((m) => (m[1] ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40));
  return { channels, programmes, names };
}

const usFiles = await discoverEpgshare01Us();
const CANDIDATES = [...BASE, ...usFiles];

for (const url of CANDIDATES) {
  const r = await get(url);
  const compressed = r.buf.length;
  const isGz = compressed > 2 && r.buf[0] === 0x1f && r.buf[1] === 0x8b;
  console.log(`\n### ${url}`);
  if (r.error) {
    console.log(`status=${r.status} error=${r.error}`);
    continue;
  }
  let xml = '';
  let decompressed = compressed;
  try {
    if (isGz) {
      const out = gunzipSync(r.buf);
      decompressed = out.length;
      xml = out.toString('utf8');
    } else {
      xml = r.buf.toString('utf8');
    }
  } catch (e) {
    console.log(`status=${r.status} type=${r.type} gzip=${isGz} pakket=${(compressed / 1e6).toFixed(1)}MB — kunne ikke pakkes ud: ${e.message}`);
    continue;
  }
  const s = summarise(xml);
  console.log(
    `status=${r.status} type=${r.type} gzip=${isGz} ` +
      `pakket=${(compressed / 1e6).toFixed(1)}MB upakket=${(decompressed / 1e6).toFixed(1)}MB ` +
      `kanaler=${s.channels} programmer=${s.programmes}` +
      `${r.finalUrl && r.finalUrl !== url ? ` final=${r.finalUrl}` : ''}`,
  );
  if (s.names.length > 0) console.log(`  navne: ${s.names.join(' | ')}`);
}

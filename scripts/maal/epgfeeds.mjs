// Hvilke offentlige XMLTV-feeds for DK/UK/US virker, hvor store er de (pakket og
// upakket), og hvor mange kanaler/programmer har de? Koeres med motoren "maal"
// (frit internet). Ingen legitimation — alt er offentlige feeds. Bruges til at
// vaelge feeds appen kan klare (40 MB upakket-graense) og til .gz-stoetten.
import { gunzipSync } from 'node:zlib';

const UA =
  'Mozilla/5.0 (Linux; Android 12; NorStream) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

const CANDIDATES = [
  // epgshare01 — per land (pakket .gz)
  'https://epgshare01.online/epgshare01/epg_ripper_DK1.xml.gz',
  'https://epgshare01.online/epgshare01/epg_ripper_UK1.xml.gz',
  'https://epgshare01.online/epgshare01/epg_ripper_US1.xml.gz',
  'https://epgshare01.online/epgshare01/epg_ripper_US_LOCALS2.xml.gz',
  // epg.pw — per land
  'https://epg.pw/xmltv/epg_DK.xml.gz',
  'https://epg.pw/xmltv/epg_GB.xml.gz',
  'https://epg.pw/xmltv/epg_US.xml.gz',
  'https://epg.pw/xmltv/epg_DK.xml',
  'https://epg.pw/xmltv/epg_GB.xml',
  // iptv-org (per land, upakket)
  'https://iptv-org.github.io/epg/guides/dk.xml',
  'https://iptv-org.github.io/epg/guides/uk.xml',
  'https://iptv-org.github.io/epg/guides/us.xml',
  // i.mjh.nz (UK Freeview som eksempel)
  'https://i.mjh.nz/DVB-T/UK.xml.gz',
  'https://i.mjh.nz/PlutoTV/us.xml.gz',
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

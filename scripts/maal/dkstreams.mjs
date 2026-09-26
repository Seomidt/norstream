// Hvilke danske stationer virker, og hvilke sender titel med?
//
// Alle Radio Browsers danske stationer aabnes med Icy-MetaData: 1 i op til
// 8 sekunder: svarer den, kommer der lyd (bytes), og kommer der en
// StreamTitle? Tabellen bruges til to regler i appen: hvilken udgave af en
// station der vaelges naar der er flere, og hvilke der kan give nu-spiller.
const UA = 'NorStream/1.0 (Android; +https://github.com/Seomidt/norstream)';

async function probe(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  const started = Date.now();
  try {
    const res = await fetch(url, { headers: { 'user-agent': UA, 'Icy-MetaData': '1' }, redirect: 'follow', signal: controller.signal });
    const type = (res.headers.get('content-type') ?? '').split(';')[0];
    const metaint = Number(res.headers.get('icy-metaint') ?? 0);
    if (!res.ok || !res.body) return { status: res.status, type, bytes: 0, metaint, title: null };
    const reader = res.body.getReader();
    let buf = Buffer.alloc(0);
    const need = metaint > 0 ? metaint * 2 + 4100 : 64 * 1024;
    while (buf.length < need && Date.now() - started < 6000) {
      const { value, done } = await reader.read();
      if (done) break;
      buf = Buffer.concat([buf, Buffer.from(value)]);
    }
    await reader.cancel().catch(() => undefined);
    let title = null;
    if (metaint > 0) {
      let pos = metaint;
      for (let i = 0; i < 2 && pos < buf.length; i++) {
        const len = buf[pos] * 16;
        const text = buf.subarray(pos + 1, pos + 1 + len).toString('utf8').replace(/\0+$/, '');
        const m = /StreamTitle='([^']*)'/.exec(text);
        if (m && m[1].length > 0) { title = m[1]; break; }
        pos = pos + 1 + len + metaint;
      }
    }
    return { status: res.status, type, bytes: buf.length, metaint, title };
  } catch (e) {
    return { status: 0, type: String(e?.name ?? e).slice(0, 14), bytes: 0, metaint: 0, title: null };
  } finally {
    clearTimeout(timer);
  }
}

const r = await fetch('https://de1.api.radio-browser.info/json/stations/bycountrycodeexact/dk?limit=300&order=votes&reverse=true&hidebroken=true', { headers: { 'user-agent': UA } });
const stations = await r.json();
console.log(`${stations.length} stationer. Kolonner: status type bytes metaint titel | navn | codec bitrate | url`);
let dead = 0, silent = 0, withTitle = 0;
const results = [];
// Otte ad gangen, ellers tager det en halv time.
for (let i = 0; i < stations.length; i += 8) {
  const batch = stations.slice(i, i + 8);
  const probed = await Promise.all(batch.map((s) => probe(s.url_resolved || s.url)));
  batch.forEach((s, j) => results.push({ s, p: probed[j] }));
}
for (const { s, p } of results) {
  const ok = p.status === 200 && p.bytes > 2000;
  if (p.status !== 200) dead++;
  else if (p.bytes <= 2000) silent++;
  if (p.title !== null) withTitle++;
  const mark = ok ? (p.title !== null ? 'OK+T' : 'OK  ') : 'FEJL';
  console.log(`${mark} ${String(p.status).padEnd(3)} ${p.type.padEnd(16)} ${String(p.bytes).padStart(6)} ${String(p.metaint).padStart(5)} ${p.title === null ? '-' : 'T'} | ${s.name.slice(0, 34).padEnd(34)} | ${(s.codec || '?').padEnd(6)} ${String(s.bitrate).padStart(3)} | ${(s.url_resolved || s.url).slice(0, 70)}`);
}
console.log(`\nDoede (ikke 200): ${dead}. Svarer men ingen lyd: ${silent}. Sender titel: ${withTitle} af ${stations.length}.`);

// Har PartyFM en stream under 320 kbit? Gaet paa de almindelige navne, og laes deres hjemmeside.
const UA = 'NorStream/1.0 (Android; +https://github.com/Seomidt/norstream)';
const guesses = [];
for (const host of ['http://stream.partyfm.dk', 'http://stream1.partyfm.dk', 'https://stream.partyfm.dk']) {
  for (const path of ['/Party320/', '/Party256/', '/Party192/', '/Party128/', '/Party96/', '/Party64/', '/party128', '/party192', '/Party128aac/', '/PartyAAC/', '/Party/', '/party', '/']) guesses.push(host + path);
}
for (const url of guesses) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), 6000);
  try {
    const r = await fetch(url, { headers: { 'user-agent': UA, 'Icy-MetaData': '1' }, signal: c.signal });
    const type = r.headers.get('content-type') ?? '';
    const br = r.headers.get('icy-br') ?? '';
    const name = r.headers.get('icy-name') ?? '';
    await r.body?.cancel();
    console.log(`${String(r.status).padEnd(3)} ${type.padEnd(22)} br=${br.padEnd(4)} ${name.padEnd(20)} ${url}`);
  } catch (e) {
    console.log(`ERR ${String(e?.name ?? e).padEnd(22)} ${''.padEnd(8)} ${''.padEnd(20)} ${url}`);
  } finally {
    clearTimeout(t);
  }
}
for (const page of ['https://www.partyfm.dk/', 'https://partyfm.dk/', 'http://stream.partyfm.dk/status-json.xsl', 'http://stream.partyfm.dk/status.xsl']) {
  try {
    const r = await fetch(page, { headers: { 'user-agent': 'Mozilla/5.0' } });
    const text = await r.text();
    const links = [...new Set([...text.matchAll(/https?:\/\/[^"'\s<>]*(?:stream|party|\.mp3|\.aac|listen)[^"'\s<>]*/gi)].map((m) => m[0]))].slice(0, 25);
    console.log(`\n${page} -> ${r.status}, ${text.length} tegn`);
    for (const l of links) console.log('  ' + l);
  } catch (e) {
    console.log(`\n${page} -> fejl ${e?.name ?? e}`);
  }
}

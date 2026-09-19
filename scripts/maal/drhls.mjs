// DR's HLS-lister: hvad staar der i dem, og kan de hentes?
const UA = 'NorStream/1.0 (Android; +https://github.com/Seomidt/norstream)';
const masters = [
  'https://drliveradio1.akamaized.net/hls/live/2097651/p1/masterab.m3u8',
  'https://drliveradio1.akamaized.net/hls/live/2097651/p5sjaelland/masterab.m3u8',
];
for (const url of masters) {
  const r = await fetch(url, { headers: { 'user-agent': UA } });
  const text = await r.text();
  console.log(`\n### ${url}\nstatus=${r.status} type=${r.headers.get('content-type')}\n${text}`);
  const variant = text.split('\n').find((l) => l.trim().length > 0 && !l.startsWith('#'));
  if (!variant) continue;
  const vurl = new URL(variant, url).toString();
  const v = await fetch(vurl, { headers: { 'user-agent': UA } });
  const vtext = await v.text();
  console.log(`--- variant ${vurl}\nstatus=${v.status}\n${vtext.split('\n').slice(0, 14).join('\n')}`);
  const seg = vtext.split('\n').find((l) => l.trim().length > 0 && !l.startsWith('#'));
  const map = /#EXT-X-MAP:URI="([^"]+)"/.exec(vtext)?.[1];
  for (const part of [map, seg].filter(Boolean)) {
    const surl = new URL(part, vurl).toString();
    const s = await fetch(surl, { headers: { 'user-agent': UA } });
    const buf = Buffer.from(await s.arrayBuffer());
    console.log(`--- ${part}: status=${s.status} type=${s.headers.get('content-type')} bytes=${buf.length} head=${buf.subarray(0, 12).toString('hex')}`);
  }
}
// Samme med ExoPlayers standard-UA, hvis DR skulle sortere paa den.
const r2 = await fetch(masters[0], { headers: { 'user-agent': 'ExoPlayerLib/1.9.0' } });
console.log(`\nMed ExoPlayer-UA: status=${r2.status}`);

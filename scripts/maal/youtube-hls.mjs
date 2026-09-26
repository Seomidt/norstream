// Hvordan ser iPhone-klientens HLS-manifest ud, og kan hele traileren hentes
// gennem det? (v331-diagnose: iPhone-klientens direkte filer afvises med 403
// ved 0:55 — YouTubes "PO-token"-spaerring. HLS skulle vaere fri af den.)
// Adresser forkortes i udskriften; kun strukturen og itag vises.

const IOS = {
  id: 5,
  ctx: { clientName: 'IOS', clientVersion: '20.10.4', deviceMake: 'Apple', deviceModel: 'iPhone16,2', osName: 'iPhone', osVersion: '18.3.2.22D82' },
  ua: 'com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)',
};
const short = (line) => line.replace(/https:\/\/[^"\s]+/g, (u) => `<url itag=${/\/itag\/(\d+)/.exec(u)?.[1] ?? '?'} ${u.includes('/hls_playlist/') ? 'playlist' : u.includes('/manifest/') ? 'manifest' : 'segment'}>`);

const r = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'User-Agent': IOS.ua, 'X-YouTube-Client-Name': '5', 'X-YouTube-Client-Version': IOS.ctx.clientVersion, Origin: 'https://www.youtube.com' },
  body: JSON.stringify({ context: { client: { ...IOS.ctx, hl: 'da', gl: 'DK' } }, videoId: 'dQw4w9WgXcQ', contentCheckOk: true, racyCheckOk: true }),
});
const data = await r.json();
const master = data.streamingData?.hlsManifestUrl;
console.log(`status=${data.playabilityStatus?.status} hls=${Boolean(master)}`);
if (master) {
  const text = await (await fetch(master)).text();
  console.log('--- master ---');
  for (const line of text.split('\n').slice(0, 40)) console.log(short(line));
  const variants = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) if (lines[i].startsWith('#EXT-X-STREAM-INF')) variants.push({ inf: lines[i], uri: lines[i + 1] });
  const best = variants.filter((v) => /RESOLUTION=\d+x1080/.test(v.inf) && /avc1/.test(v.inf))[0] ?? variants.at(-1);
  console.log(`--- 1080p-variant: ${short(best.inf)}`);
  const media = await (await fetch(best.uri)).text();
  const mediaLines = media.split('\n');
  console.log(mediaLines.slice(0, 12).map(short).join('\n'));
  const segments = mediaLines.filter((l) => l.startsWith('http'));
  console.log(`segmenter: ${segments.length}; ENDLIST=${media.includes('#EXT-X-ENDLIST')}`);
  const statuses = [];
  for (const [i, seg] of segments.entries()) {
    const s = await fetch(seg, { headers: { 'User-Agent': 'ExoPlayerLib/1.4.1' } });
    await s.arrayBuffer();
    statuses.push(s.status);
    if (s.status !== 200) { console.log(`STOP ved segment ${i}: ${s.status}`); break; }
  }
  console.log(`hentet ${statuses.length} segmenter, statusser ${[...new Set(statuses)].join(',')}`);
}

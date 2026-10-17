// Fjerner et besoegs-id (visitorData) YouTubes robot-tjek? Paa brugerens boks
// (v332): VR-klienten faar LOGIN_REQUIRED ("bekraeft at du ikke er en robot"),
// og iPhone-klienten giver ingen HLS. Fra GitHub: foerste video OK, derefter
// LOGIN_REQUIRED — samme tilstand. Her: sammenlign uden og med besoegs-id.

const CLIENTS = {
  VR: {
    id: 28,
    ctx: { clientName: 'ANDROID_VR', clientVersion: '1.62.27', deviceMake: 'Oculus', deviceModel: 'Quest 3', androidSdkVersion: 32, osName: 'Android', osVersion: '12L' },
    ua: 'com.google.android.apps.youtube.vr.oculus/1.62.27 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip',
  },
  IOS: {
    id: 5,
    ctx: { clientName: 'IOS', clientVersion: '20.10.4', deviceMake: 'Apple', deviceModel: 'iPhone16,2', osName: 'iPhone', osVersion: '18.3.2.22D82' },
    ua: 'com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)',
  },
};
const VIDEOS = ['dQw4w9WgXcQ', 'Way9Dexny3w', 'uYPbbksJxIg'];
const BROWSER = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

async function player(client, videoId, visitorData) {
  const headers = {
    'Content-Type': 'application/json',
    'User-Agent': client.ua,
    'X-YouTube-Client-Name': String(client.id),
    'X-YouTube-Client-Version': client.ctx.clientVersion,
    Origin: 'https://www.youtube.com',
  };
  if (visitorData) headers['X-Goog-Visitor-Id'] = visitorData;
  const ctx = { ...client.ctx, hl: 'da', gl: 'DK', ...(visitorData ? { visitorData } : {}) };
  const r = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
    method: 'POST',
    headers,
    body: JSON.stringify({ context: { client: ctx }, videoId, contentCheckOk: true, racyCheckOk: true }),
  });
  const d = await r.json();
  const sd = d.streamingData ?? {};
  return `${d.playabilityStatus?.status}${d.playabilityStatus?.reason ? ` "${d.playabilityStatus.reason.slice(0, 40)}"` : ''} hls=${Boolean(sd.hlsManifestUrl)} filer=${(sd.adaptiveFormats ?? []).filter((f) => f.url).length} svarVisitor=${Boolean(d.responseContext?.visitorData)}`;
}

async function visitorFromEmbed(videoId) {
  const r = await fetch(`https://www.youtube.com/embed/${videoId}`, { headers: { 'User-Agent': BROWSER, Cookie: 'SOCS=CAI; CONSENT=YES+1' } });
  const html = await r.text();
  return /"VISITOR_DATA":"([^"]+)"/.exec(html)?.[1] ?? null;
}

async function visitorFromSw() {
  const r = await fetch('https://www.youtube.com/sw.js_data', { headers: { 'User-Agent': BROWSER, Cookie: 'SOCS=CAI' } });
  const text = (await r.text()).replace(/^\)\]\}'/, '');
  try {
    return JSON.parse(text)[0][2][0][0][13] ?? null;
  } catch {
    return null;
  }
}

console.log('# Uden besoegs-id (for at blive mistaenkt):');
for (const v of VIDEOS) for (const [name, c] of Object.entries(CLIENTS)) console.log(`  ${v} ${name}: ${await player(c, v)}`);

const fromEmbed = await visitorFromEmbed(VIDEOS[1]);
const fromSw = await visitorFromSw();
console.log(`\n# Besoegs-id: fra embed=${fromEmbed ? `ja (${fromEmbed.length} tegn)` : 'nej'}, fra sw.js_data=${fromSw ? `ja (${fromSw.length} tegn)` : 'nej'}`);
for (const [label, visitor] of [['embed', fromEmbed], ['sw', fromSw]]) {
  if (!visitor) continue;
  for (const v of VIDEOS) for (const [name, c] of Object.entries(CLIENTS)) console.log(`  ${label} ${v} ${name}: ${await player(c, v, visitor)}`);
}

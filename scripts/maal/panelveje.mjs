// Maaler panelets EPG-veje fra GitHubs net, UDEN rigtige legitimationsoplysninger
// (testlegitimation: panelet skal bare vise om vejen findes). Spoergsmaalet
// (v359, ny boks): svarer panelet 404 paa get_short_epg og xmltv.php for alle,
// eller kun for den ene boks? Et panel uden EPG-vej svarer 404 ogsaa paa test;
// et panel med vejen svarer 401/403 eller 200 med auth 0.
//
// Vaert: panelets navn som brugeren selv har vist (ingen hemmelighed i det).
const HOST = process.env.PANEL_HOST ?? 'line.trx-hub.xyz';
const TIMEOUT_MS = 15_000;

async function probe(path, headers = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`http://${HOST}/${path}`, { headers, signal: controller.signal, redirect: 'manual' });
    const text = await response.text();
    const server = response.headers.get('server') ?? '-';
    const type = response.headers.get('content-type') ?? '-';
    const location = response.headers.get('location');
    return `HTTP ${response.status} · ${text.length} B · server ${server} · ${type}${location ? ` · → ${location.replace(/(username|password)=[^&]*/g, '$1=…')}` : ''} · "${text.slice(0, 80).replace(/\s+/g, ' ')}"`;
  } catch (cause) {
    return `fejl: ${cause instanceof Error ? cause.message : String(cause)}`;
  } finally {
    clearTimeout(timer);
  }
}

const paths = [
  'player_api.php?username=test&password=test',
  'player_api.php?username=test&password=test&action=get_live_categories',
  'player_api.php?username=test&password=test&action=get_short_epg&stream_id=1&limit=3',
  'player_api.php?username=test&password=test&action=get_simple_data_table&stream_id=1',
  'xmltv.php?username=test&password=test',
  'xmltv.php',
  'player_api.php',
  'get.php?username=test&password=test&type=m3u_plus',
  'live/test/test/1.ts',
];

console.log(`# Panelveje for ${HOST} (testlegitimation)`);
for (const ua of ['okhttp/4.12.0', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0 Safari/537.36']) {
  console.log(`\n## User-Agent: ${ua.slice(0, 20)}`);
  for (const path of paths) {
    console.log(`- ${path.padEnd(85)} ${await probe(path, { 'User-Agent': ua })}`);
  }
}
console.log('\n## Uden Host-hoved (ip direkte), som DNS-noedudgangen uden navn:');
try {
  const { promises: dns } = await import('node:dns');
  const ips = await dns.resolve4(HOST);
  console.log(`- A-poster: ${ips.join(', ')}`);
  for (const ip of ips.slice(0, 3)) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(`http://${ip}/player_api.php?username=test&password=test`, { signal: controller.signal, redirect: 'manual' });
      console.log(`- ${ip} uden Host: HTTP ${response.status}`);
      const withHost = await fetch(`http://${ip}/player_api.php?username=test&password=test`, { headers: { Host: HOST }, signal: controller.signal, redirect: 'manual' });
      console.log(`- ${ip} med Host: HTTP ${withHost.status}`);
    } catch (cause) {
      console.log(`- ${ip}: fejl ${cause instanceof Error ? cause.message : String(cause)}`);
    } finally {
      clearTimeout(timer);
    }
  }
} catch (cause) {
  console.log(`- DNS: ${cause instanceof Error ? cause.message : String(cause)}`);
}

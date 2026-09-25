// Stopper traileren foer tid fordi YouTube holder op med at udlevere filen?
// (Brugeren, v329: "super billede, men det stopper inden traileren er faerdig
// hver gang".) Koeres med motoren "maal". For den foerste video og hver
// app-klient: hent HELE 1080p-videoen og lyden i stykker, som afspilleren
// goer, og sig hvor (og om) det gaar galt — status, byte og tid.

const VIDEO_ID = 'dQw4w9WgXcQ';
const CHUNK = 2 * 1024 * 1024;

const CLIENTS = {
  ANDROID_VR: {
    id: 28,
    ctx: {
      clientName: 'ANDROID_VR',
      clientVersion: '1.62.27',
      deviceMake: 'Oculus',
      deviceModel: 'Quest 3',
      androidSdkVersion: 32,
      osName: 'Android',
      osVersion: '12L',
    },
    ua: 'com.google.android.apps.youtube.vr.oculus/1.62.27 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip',
  },
  IOS: {
    id: 5,
    ctx: {
      clientName: 'IOS',
      clientVersion: '20.10.4',
      deviceMake: 'Apple',
      deviceModel: 'iPhone16,2',
      osName: 'iPhone',
      osVersion: '18.3.2.22D82',
    },
    ua: 'com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)',
  },
};

async function player(client) {
  const r = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': client.ua,
      'X-YouTube-Client-Name': String(client.id),
      'X-YouTube-Client-Version': client.ctx.clientVersion,
      Origin: 'https://www.youtube.com',
    },
    body: JSON.stringify({ context: { client: { ...client.ctx, hl: 'da', gl: 'DK' } }, videoId: VIDEO_ID, contentCheckOk: true, racyCheckOk: true }),
  });
  return r.json();
}

async function whole(label, format) {
  const total = Number(format.contentLength);
  const t0 = Date.now();
  let got = 0;
  let requests = 0;
  const statuses = new Map();
  while (!Number.isFinite(total) || got < total) {
    const end = Number.isFinite(total) ? Math.min(got + CHUNK, total) - 1 : got + CHUNK - 1;
    let status;
    let bytes = 0;
    try {
      const r = await fetch(format.url, { headers: { 'User-Agent': 'ExoPlayerLib/1.4.1', Range: `bytes=${got}-${end}` } });
      status = r.status;
      bytes = (await r.arrayBuffer()).byteLength;
    } catch (e) {
      status = `FEJL ${e.name}`;
    }
    requests += 1;
    statuses.set(status, (statuses.get(status) ?? 0) + 1);
    if (status !== 206 && status !== 200) {
      console.log(`  ${label}: STOP ved byte ${got} af ${total} (${((100 * got) / total).toFixed(0)} %), status ${status}, efter ${requests} kald`);
      return;
    }
    if (bytes === 0) break;
    got += bytes;
  }
  console.log(`  ${label}: HELE filen (${got} af ${total} bytes) i ${requests} kald, ${Date.now() - t0} ms, statusser ${JSON.stringify([...statuses])}`);
}

for (const [name, client] of Object.entries(CLIENTS)) {
  const data = await player(client);
  const status = data.playabilityStatus?.status;
  const formats = data.streamingData?.adaptiveFormats ?? [];
  const video = formats.find((f) => f.itag === 137);
  const audio = formats.find((f) => f.itag === 140);
  console.log(`\n${name}: status=${status} laengde=${data.videoDetails?.lengthSeconds}s video137=${video?.contentLength} (${video?.approxDurationMs} ms) lyd140=${audio?.contentLength} (${audio?.approxDurationMs} ms)`);
  if (video?.url) {
    const params = new URL(video.url).searchParams;
    console.log(`  adresse-felter: ${[...params.keys()].join(',')}`);
    console.log(`  expire om ${Math.round((Number(params.get('expire')) * 1000 - Date.now()) / 60000)} min; clen=${params.get('clen')} dur=${params.get('dur')}`);
    await whole('video 137', video);
  }
  if (audio?.url) await whole('lyd 140', audio);
  await new Promise((resolve) => setTimeout(resolve, 3000));
}

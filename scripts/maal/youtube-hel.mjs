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

/**
 * Som afspilleren: i afspilningens tempo, 30 s foran. Hvert stykke venter
 * til dets tidspunkt i videoen minus bufferen. Sig hvornaar (sekunder inde)
 * det evt. gaar galt.
 */
async function paced(label, video, audio) {
  const t0 = Date.now();
  const seconds = Number(video.approxDurationMs) / 1000;
  const bytesPerSecond = Number(video.contentLength) / seconds;
  let got = 0;
  let audioGot = 0;
  const audioPerSecond = Number(audio.contentLength) / seconds;
  const want = (fmt, from, to) =>
    fetch(fmt.url, { headers: { 'User-Agent': 'ExoPlayerLib/1.4.1', Range: `bytes=${from}-${to}` } }).then(async (r) => [r.status, (await r.arrayBuffer()).byteLength]);
  while (got < Number(video.contentLength)) {
    const at = got / bytesPerSecond;
    const wait = (at - 30) * 1000 - (Date.now() - t0);
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    const end = Math.min(got + 512 * 1024, Number(video.contentLength)) - 1;
    const [status, bytes] = await want(video, got, end).catch((e) => [`FEJL ${e.name}`, 0]);
    if (status !== 206) {
      console.log(`  ${label}: STOP ved ${at.toFixed(0)} s inde i videoen, ${((Date.now() - t0) / 1000).toFixed(0)} s efter start, status ${status}`);
      return;
    }
    got += bytes;
    const audioEnd = Math.min(Math.round(got / bytesPerSecond * audioPerSecond) + 65536, Number(audio.contentLength)) - 1;
    if (audioEnd > audioGot) {
      const [aStatus, aBytes] = await want(audio, audioGot, audioEnd).catch((e) => [`FEJL ${e.name}`, 0]);
      if (aStatus !== 206) {
        console.log(`  ${label}: LYD STOP ved ${at.toFixed(0)} s inde, status ${aStatus}`);
        return;
      }
      audioGot += aBytes;
    }
  }
  console.log(`  ${label}: HELE vejen i afspilningstempo (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
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
  if (video?.url && audio?.url && name === 'ANDROID_VR') {
    // Nye adresser: de gamle er lige blevet hentet hele.
    const fresh = await player(client);
    const f = fresh.streamingData?.adaptiveFormats ?? [];
    await paced('i tempo', f.find((x) => x.itag === 137), f.find((x) => x.itag === 140));
  }
  await new Promise((resolve) => setTimeout(resolve, 3000));
}

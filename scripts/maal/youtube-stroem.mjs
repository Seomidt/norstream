// Kan appen selv hente en YouTube-trailers videofil og spille den i sin egen
// afspiller (som Googles tv-butik, SmartTube og NewPipe)? Koeres med motoren
// "maal" (frit internet). Proever YouTubes egne app-klienter mod
// /youtubei/v1/player og siger for hver: maa den spilles, er der en
// HLS-adresse (én adresse, lyd og billede sammen), er der direkte
// adresser i HD, og svarer videofilen faktisk (ikke 403).
//
// Bemaerk: GitHubs maskine er et datacenter; YouTube er strengere dér end
// hjemme hos brugeren. Et "LOGIN_REQUIRED/bot" her er ikke dommen for boksen.

const VIDEOS = [
  ['Rick Astley (3:33)', 'dQw4w9WgXcQ'],
  ['Dune: Part Two, trailer', 'Way9Dexny3w'],
];

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
  ANDROID: {
    id: 3,
    ctx: { clientName: 'ANDROID', clientVersion: '20.10.38', androidSdkVersion: 30, osName: 'Android', osVersion: '11' },
    ua: 'com.google.android.youtube/20.10.38 (Linux; U; Android 11) gzip',
  },
  TVHTML5_SIMPLY: {
    id: 75,
    ctx: { clientName: 'TVHTML5_SIMPLY', clientVersion: '1.0' },
    ua: 'Mozilla/5.0 (ChromiumStylePlatform) Cobalt/Version',
  },
};

async function timed(url, init, ms = 20000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  const t0 = Date.now();
  try {
    const r = await fetch(url, { ...init, signal: controller.signal });
    return { r, ms: Date.now() - t0 };
  } finally {
    clearTimeout(timer);
  }
}

async function player(client, videoId) {
  const body = {
    context: { client: { ...client.ctx, hl: 'da', gl: 'DK' } },
    videoId,
    contentCheckOk: true,
    racyCheckOk: true,
  };
  const { r, ms } = await timed('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': client.ua,
      'X-YouTube-Client-Name': String(client.id),
      'X-YouTube-Client-Version': client.ctx.clientVersion,
      Origin: 'https://www.youtube.com',
    },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // Ikke JSON; status siger nok.
  }
  return { status: r.status, ms, json };
}

async function probeUrl(url, ua) {
  try {
    const { r, ms } = await timed(url, { headers: { 'User-Agent': ua, Range: 'bytes=0-65535' } }, 15000);
    const buf = await r.arrayBuffer();
    return `${r.status} ${buf.byteLength}B ${ms}ms`;
  } catch (e) {
    return `FEJL ${e.name}`;
  }
}

for (const [label, videoId] of VIDEOS) {
  console.log(`\n=== ${label} (${videoId})`);
  for (const [name, client] of Object.entries(CLIENTS)) {
    let res;
    try {
      res = await player(client, videoId);
    } catch (e) {
      console.log(`${name.padEnd(15)} FEJL ${e.name}: ${e.message}`);
      continue;
    }
    const ps = res.json?.playabilityStatus ?? {};
    const sd = res.json?.streamingData ?? {};
    const af = sd.adaptiveFormats ?? [];
    const direct = af.filter((f) => typeof f.url === 'string');
    const ciphered = af.filter((f) => f.signatureCipher || f.cipher).length;
    const videos = direct.filter((f) => f.mimeType?.startsWith('video/')).sort((a, b) => (b.height ?? 0) - (a.height ?? 0));
    const audios = direct.filter((f) => f.mimeType?.startsWith('audio/'));
    console.log(
      `${name.padEnd(15)} http=${res.status} ${res.ms}ms status=${ps.status} ${ps.reason ? `"${ps.reason}"` : ''}` +
        ` formater=${af.length} direkte=${direct.length} krypteret=${ciphered}` +
        ` hls=${Boolean(sd.hlsManifestUrl)} dash=${Boolean(sd.dashManifestUrl)} sabr=${Boolean(sd.serverAbrStreamingUrl)}` +
        ` muxed=${(sd.formats ?? []).length}`,
    );
    const heights = [...new Set(videos.map((f) => `${f.height}${f.mimeType.includes('mp4') ? 'mp4' : 'webm'}`))];
    if (heights.length > 0) console.log(`                video: ${heights.join(' ')}; lyd: ${audios.map((f) => f.itag).join(' ')}`);
    const best = videos.find((f) => f.height <= 1080 && f.mimeType.includes('mp4')) ?? videos[0];
    if (best) {
      const hasN = /[?&]n=/.test(best.url);
      const hasPot = /[?&]pot=/.test(best.url);
      console.log(
        `                ${best.itag} ${best.height}p init=${JSON.stringify(best.initRange)} index=${JSON.stringify(best.indexRange)} n=${hasN} pot=${hasPot}` +
          ` -> ${await probeUrl(best.url, client.ua)}`,
      );
      const audio = audios.find((f) => f.itag === 140) ?? audios[0];
      if (audio) console.log(`                lyd ${audio.itag} -> ${await probeUrl(audio.url, client.ua)}`);
    }
    if (sd.hlsManifestUrl) {
      try {
        const { r, ms } = await timed(sd.hlsManifestUrl, { headers: { 'User-Agent': client.ua } });
        const m3u8 = await r.text();
        const variants = [...m3u8.matchAll(/RESOLUTION=(\d+x\d+)/g)].map((m) => m[1]);
        console.log(`                HLS ${r.status} ${ms}ms varianter: ${[...new Set(variants)].join(' ')}`);
        const firstVariant = m3u8.split('\n').find((l) => l.startsWith('http'));
        if (firstVariant) {
          const { r: vr } = await timed(firstVariant, { headers: { 'User-Agent': client.ua } });
          const playlist = await vr.text();
          const seg = playlist.split('\n').find((l) => l.startsWith('http'));
          console.log(`                HLS-variant ${vr.status}; foerste stykke -> ${seg ? await probeUrl(seg, client.ua) : 'intet'}`);
        }
      } catch (e) {
        console.log(`                HLS FEJL ${e.name}`);
      }
    }
  }
}

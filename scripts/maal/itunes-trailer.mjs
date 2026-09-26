// Kan trailere tages fra iTunes (Apples officielle, aabne soegetjeneste)?
// For film har svaret en `previewUrl` — traileren. Hvilken oploesning, hvor
// lang, kan den hentes, og findes den i den danske butik?

const TITLES = ['Dune Part Two', 'Oppenheimer', 'Tuner', 'Gladiator II', 'Druk'];

async function range(url, from, to) {
  const r = await fetch(url, { headers: { 'User-Agent': 'ExoPlayerLib/1.4.1', Range: `bytes=${from}-${to}` } });
  const cr = r.headers.get('content-range') ?? '';
  const buf = new Uint8Array(await r.arrayBuffer());
  return { status: r.status, total: Number(cr.split('/')[1] ?? 0), buf };
}

/** Bredde x hoejde fra mp4'ens tkhd-bokse (sidste 8 bytes: 16.16 fixed). */
function dimensions(buf) {
  const out = [];
  for (let i = 0; i + 4 < buf.length; i++) {
    if (buf[i] === 0x74 && buf[i + 1] === 0x6b && buf[i + 2] === 0x68 && buf[i + 3] === 0x64) {
      const version = buf[i + 4];
      const end = i + 4 + (version === 1 ? 96 : 84) - 4;
      const w = ((buf[end - 4] << 8) | buf[end - 3]);
      const h = ((buf[end] << 8) | buf[end + 1]);
      if (w > 0 && h > 0) out.push(`${w}x${h}`);
    }
  }
  return out.join(',') || '?';
}

for (const country of ['dk', 'us']) {
  console.log(`\n##### land=${country}`);
  for (const term of TITLES) {
    const r = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(term)}&media=movie&entity=movie&limit=3&country=${country}`);
    const d = await r.json().catch(() => ({}));
    const hit = (d.results ?? [])[0];
    if (!hit) {
      console.log(`  ${term}: http=${r.status} intet`);
      continue;
    }
    const url = hit.previewUrl;
    console.log(`  ${term}: "${hit.trackName}" (${(hit.releaseDate ?? '').slice(0, 4)}) preview=${url ? new URL(url).pathname.split('/').pop() : '-'}`);
    if (url) {
      const head = await range(url, 0, 262143);
      const tail = head.total > 0 ? await range(url, Math.max(0, head.total - 262144), head.total - 1) : null;
      console.log(`     status=${head.status} stoerrelse=${head.total} oploesning(start)=${dimensions(head.buf)} oploesning(slut)=${tail ? dimensions(tail.buf) : '?'}`);
    }
  }
}

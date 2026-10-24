// Hele Apple TV-kaeden med PRAECIS appens kode (appleTrailer.ts og
// buildHlsMaster fra youtubeStream.ts): find titlen, vaelg traileren, byg
// 1080p-manifestet og hent video + lyd. Koerer sig selv igen med type-
// stripning, hvis Node ikke kan laese .ts direkte.
import { spawnSync } from 'node:child_process';

if (!process.env.NS_STRIPPED) {
  try {
    await import('../../packages/app/src/features/vod/appleTrailer.ts');
  } catch {
    const r = spawnSync(process.execPath, ['--experimental-strip-types', process.argv[1]], { stdio: 'inherit', env: { ...process.env, NS_STRIPPED: '1' } });
    process.exit(r.status ?? 1);
  }
}
console.log(`node ${process.version}`);
const { findAppleTrailers } = await import('../../packages/app/src/features/vod/appleTrailer.ts');
const { buildHlsMaster } = await import('../../packages/app/src/features/vod/youtubeStream.ts');

const UA = 'ExoPlayerLib/1.4.1';
const getJson = async (url) => {
  const r = await fetch(url, { headers: { Origin: 'https://tv.apple.com' } });
  return r.ok ? r.json() : null;
};
const text = async (url) => {
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  return r.ok ? r.text() : null;
};

const CASES = [
  ['movie', ['Oppenheimer'], 2023],
  ['movie', ['Dune: Part Two', 'Dune: Part Two'], 2024],
  ['movie', ['Another Round', 'Druk'], 2020],
  ['movie', ['Napoleon'], 2023],
  ['series', ['Severance'], 2022],
];
for (const [kind, titles, year] of CASES) {
  const found = await findAppleTrailers(getJson, kind, titles, year);
  console.log(`\n${kind} ${titles[0]} (${year}): ${found.length} trailere ${found.map((t) => `"${t.name}" ${t.seconds ?? '?'}s`).join(', ')}`);
  const best = found[0];
  if (!best) continue;
  const master = await text(best.url);
  if (master === null) {
    console.log('  hovedmanifest: fejl');
    continue;
  }
  const built = buildHlsMaster(master, best.url);
  if (built === null) {
    console.log(`  buildHlsMaster: null. Manifestets foerste linjer: ${master.split('\n').slice(0, 6).join(' | ').slice(0, 300)}`);
    continue;
  }
  const lines = built.playlist.split('\n');
  const inf = lines.find((l) => l.startsWith('#EXT-X-STREAM-INF')) ?? '';
  const audio = lines.filter((l) => l.startsWith('#EXT-X-MEDIA')).length;
  console.log(`  valgt: ${/RESOLUTION=[^,]+/.exec(inf)?.[0]} ${/CODECS="[^"]+"/.exec(inf)?.[0]} lydlinjer=${audio}`);
  const variant = await text(built.firstUri);
  const segs = (variant ?? '').split('\n').filter((l) => l && !l.startsWith('#'));
  const map = /#EXT-X-MAP:URI="([^"]+)"/.exec(variant ?? '')?.[1];
  const key = /#EXT-X-KEY:METHOD=([A-Z0-9-]+)/.exec(variant ?? '')?.[1] ?? 'ingen';
  console.log(`  video-variant: ${segs.length} stykker, noegle=${key}, map=${map ? 'ja' : 'nej'}`);
  const abs = (u) => new URL(u, built.firstUri).href;
  for (const [label, u] of [['foerste', segs[0]], ['sidste', segs.at(-1)]]) {
    if (!u) continue;
    const r = await fetch(abs(u), { headers: { 'User-Agent': UA, Range: 'bytes=0-65535' } });
    await r.arrayBuffer();
    console.log(`  ${label} stykke: ${r.status}`);
  }
  const audioUri = /TYPE=AUDIO[^\n]*URI="([^"]+)"/.exec(built.playlist)?.[1] ?? /URI="([^"]+)"[^\n]*TYPE=AUDIO/.exec(built.playlist)?.[1];
  if (audioUri) {
    const a = await text(audioUri);
    console.log(`  lyd: ${a === null ? 'fejl' : `${a.split('\n').filter((l) => l && !l.startsWith('#')).length} stykker`}`);
  }
}

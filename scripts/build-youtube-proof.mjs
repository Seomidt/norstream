import { build } from 'esbuild';
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const bundled = await build({ absWorkingDir: root, entryPoints: ['scripts/youtube-proof-browser.ts'], bundle: true, write: false, minify: true, platform: 'browser', format: 'iife', target: 'chrome100', legalComments: 'inline' });
const licenses = await Promise.all(['bgutils-js', 'youtubei.js', 'meriyah', 'fflate'].map(async (name) => {
  const path = require.resolve(name === 'bgutils-js' ? 'bgutils-js/botguard' : name);
  let directory = new URL('.', `file://${path}`);
  for (let i = 0; i < 7; i++, directory = new URL('../', directory)) {
    for (const file of ['LICENSE', 'LICENSE.md']) { try { return `\n${name}\n` + await readFile(new URL(file, directory), 'utf8'); } catch {} }
  }
  throw new Error(`Missing license for ${name}`);
}));
licenses.push(await readFile(`${root}scripts/licenses/protobuf-apache.txt`, 'utf8'), await readFile(`${root}scripts/licenses/protobuf-bsd.txt`, 'utf8'));
const out = `${root}packages/app/src/features/vod/generated`;
await mkdir(out, { recursive: true });
await writeFile(`${out}/youtubeProofBundle.ts`, `// Genereret af scripts/build-youtube-proof.mjs; maa ikke redigeres.\nexport const youtubeProofBundle = ${JSON.stringify(bundled.outputFiles[0].text.replace(/<\/script/gi, '<\\/script'))};\nexport const youtubeProofLicenses = ${JSON.stringify(licenses.join('\n'))};\n`);
console.log('YouTube proof browser bundle:', bundled.outputFiles[0].text.length, 'bytes');

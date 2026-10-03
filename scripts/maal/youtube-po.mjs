// Koer paa en GitHub-runner med frit internet: motor=maal, url=youtube-po.
// Bruger appens faktiske browserkode og kontrollerer ALLE video/lyd-bytes.
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
const root = resolve('');
const lab = await mkdtemp(join(tmpdir(), 'norstream-po-'));
let browser;
try {
  execFileSync('npm', ['ci'], { cwd: root, stdio: 'ignore' });
  execFileSync('npm', ['install', '--prefix', lab, '--no-audit', '--no-fund', 'playwright@1.58.2'], { stdio: 'ignore' });
  const require = createRequire(join(lab, 'package.json'));
  const { chromium } = require('playwright');
  execFileSync(process.execPath, [require.resolve('playwright/cli'), 'install', 'chromium'], { stdio: 'ignore' });
  const generated = await readFile(join(root, 'packages/app/src/features/vod/generated/youtubeProofBundle.ts'), 'utf8');
  const bundle = JSON.parse(generated.match(/export const youtubeProofBundle = (.*);\n/)[1]);
  browser = await chromium.launch({ headless: true });
  for (const id of ['uYPbbksJxIg', 'Way9Dexny3w']) {
    const page = await browser.newPage();
    let complete;
    let fail;
    const result = new Promise((resolve, reject) => { complete = resolve; fail = reject; });
    // Kun vores egen maaleside, ingen login/konto eller interaktion paa YouTube.
    await page.route('https://www.youtube.com/norstream-proof-test', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body></body></html>' }));
    await page.goto('https://www.youtube.com/norstream-proof-test');
    await page.exposeFunction('nativeProofMessage', async (data) => {
      const message = JSON.parse(data);
      if (message.type === 'ready') await page.evaluate((id) => window.NorStreamProofStart(id), id);
      if (message.type === 'request') {
        let reply = { serial: message.serial, error: true };
        try {
          const response = await fetch(message.url, { method: message.method, headers: message.headers, body: message.body, signal: AbortSignal.timeout(15000) });
          reply = { serial: message.serial, status: response.status, headers: Object.fromEntries(response.headers), body: await response.text() };
        } catch {}
        await page.evaluate((reply) => window.NorStreamProofReply(reply), reply).catch(() => {});
      }
      if (message.type === 'resolved') complete(message);
      if (message.type === 'failed') fail(new Error(`PO phase: ${message.phase}`));
    });
    await page.evaluate(() => { window.ReactNativeWebView = { postMessage: window.nativeProofMessage }; });
    await page.addScriptTag({ content: bundle });
    let timer;
    const payload = await Promise.race([result, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('PO deadline')), 90000); })]).finally(() => clearTimeout(timer));
    console.log(`${id}: aegte PO + ${payload.video.height}p, ${payload.seconds}s`);
    for (const [kind, media] of [['video', payload.video], ['audio', payload.audio]]) {
      const response = await fetch(media.url, { headers: { 'User-Agent': payload.userAgent }, signal: AbortSignal.timeout(90000) });
      let bytes = 0;
      for await (const chunk of response.body) bytes += chunk.length;
      const full = response.ok && bytes === media.contentLength;
      console.log(`${kind}: HTTP ${response.status}, ${bytes}/${media.contentLength} bytes, hel=${full}`);
      if (!full) throw new Error('Filen var ikke hel');
    }
    await page.close();
  }
  console.log('PASS: begge trailere hentet helt, inklusiv lyd. Hardware-afspilning skal stadig testes.');
} catch (error) {
  // Fejlbeskeder fra hente-/byggelaget kan indeholde signed URLs; vis kun klasse.
  console.log('FAIL: bevis eller hel fil kunne ikke verificeres', error.name);
  process.exitCode = 1;
} finally {
  await browser?.close();
  await rm(lab, { recursive: true, force: true });
}

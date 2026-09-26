// Bygger listen over filer i det aabne logo-arkiv tv-logo/tv-logos.
//
// Arkivet har ingen indeksfil, og GitHubs API har en graense paa tres kald i
// timen uden noegle — ingen af delene kan en app paa en telefon leve med. I
// stedet ligger listen med i bundtet, og den her bygger den.
//
// Koeres med:  node scripts/build-tv-logos-index.mjs
//
// Der hentes **ingen billeder**: `--filter=blob:none` giver traeet uden
// indholdet, saa det er nogle faa hundrede kilobyte frem for et par hundrede
// megabyte.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REPO = 'https://github.com/tv-logo/tv-logos.git';
const OUT = new URL('../assets/tv-logos.json', import.meta.url);

const work = mkdtempSync(join(tmpdir(), 'tv-logos-'));
try {
  execFileSync(
    'git',
    ['clone', '--filter=blob:none', '--no-checkout', '--depth', '1', REPO, work],
    { stdio: 'inherit' },
  );
  const files = execFileSync('git', ['-C', work, 'ls-tree', '-r', '--name-only', 'HEAD'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
    .split('\n')
    .filter((path) => path.startsWith('countries/') && path.endsWith('.png'))
    // Praefiks og endelse er ens for hver eneste raekke. De laegges paa igen i
    // appen; her sparer de en fjerdedel af filens stoerrelse.
    .map((path) => path.slice('countries/'.length, -'.png'.length))
    .sort();

  writeFileSync(OUT, `${JSON.stringify(files)}\n`);
  console.log(`${files.length} logoer skrevet til ${OUT.pathname}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}

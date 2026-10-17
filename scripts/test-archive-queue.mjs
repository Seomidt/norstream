import { readdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Koer den faktiske Kotlin-controller mod deterministiske Android/Media3-porte.
// APK-bygget kontrollerer desuden de rigtige Media3-signaturer og native bridge.
const compilerRoot = process.argv[2];
if (!compilerRoot) throw new Error('Angiv mappen med Kotlin 2.2 compiler-embeddable og dens Maven-afhaengigheder');
const compilerFiles = (await readdir(compilerRoot)).filter(f => f.endsWith('.jar'));
const compiler = compilerFiles.map(f => join(compilerRoot, f)).join(':');
const stdlib = join(compilerRoot, 'kotlin-stdlib-2.2.0.jar');
const tests = fileURLToPath(new URL('./native/tests/', import.meta.url));
const output = await mkdtemp(join(tmpdir(), 'norstream-archive-queue-'));
function run(args) {
  const result = spawnSync('java', args, { encoding: 'utf8', timeout: 60_000 });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.status !== 0) throw new Error(result.stderr || String(result.error));
}
try {
  const inputs = (await readdir(tests)).filter(f => f.endsWith('.kt')).map(f => join(tests, f));
  const jar = join(output, 'tests.jar');
  run(['-cp', compiler, 'org.jetbrains.kotlin.cli.jvm.K2JVMCompiler', '-no-stdlib', '-no-reflect', '-jvm-target', '17', '-classpath', stdlib, '-d', jar,
    fileURLToPath(new URL('./native/NorstreamArchiveQueue.kt', import.meta.url)), ...inputs]);
  run(['-cp', jar + ':' + stdlib, 'norstream.tests.ArchiveQueueTestKt']);
} finally {
  await rm(output, { recursive: true, force: true });
}

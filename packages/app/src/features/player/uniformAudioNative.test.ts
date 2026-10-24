import { expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

it('native signalbehandling udjaevner kanaler og beskytter mod lydspidser', () => {
  const dir = mkdtempSync(join(tmpdir(), 'norstream-audio-'));
  const root = new URL('../../../../../scripts/native-audio/', import.meta.url);
  try {
    execFileSync('java', ['com.sun.tools.javac.Main', '-d', dir,
      fileURLToPath(new URL('NorstreamLeveler.java', root)), fileURLToPath(new URL('NorstreamLevelerTest.java', root))], { timeout: 25000 });
    const report = execFileSync('java', ['-cp', dir, 'expo.modules.video.player.NorstreamLevelerTest'], { timeout: 15000, encoding: 'utf8' });
    expect(report).toContain('PCM-test OK');
  } finally { rmSync(dir, { recursive: true, force: true }); }
}, 45000);

it('TV-afspilleren og preview bruger native PCM med passthrough og offload afvist', () => {
  const require = createRequire(import.meta.url);
  const root = require.resolve('expo-video/package.json').replace('package.json', 'android/src/main/java/expo/modules/video/');
  const factory = readFileSync(root + 'player/NorstreamRenderersFactory.java', 'utf8');
  expect(factory).toContain('new NorstreamAudioProcessor()');
  expect(factory).toContain('MimeTypes.AUDIO_RAW.equals(format.sampleMimeType)');
  expect(factory).toContain('AudioOffloadSupport.DEFAULT_UNSUPPORTED');
  const record = readFileSync(root + 'records/PlayerBuilderOptions.kt', 'utf8');
  expect(record).toContain('norstreamUniformAudio: Boolean = false');
});

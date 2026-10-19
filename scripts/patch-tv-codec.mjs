import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const replacements = {
  'records/PlayerBuilderOptions.kt': {
    hash: '96d1f644839240ccd3d2e77ab1556d54a0fb9d2a71d76b8e25a0d041b20f8056',
    edits: [[
      '  @Field var seekForwardIncrement: Duration? = null',
      '  @Field var seekForwardIncrement: Duration? = null,\n  @Field var norstreamSynchronousCodec: Boolean = false',
    ]],
  },
  'records/VideoEventPayloads.kt': {
    hash: '694cd0535a758823166b07fb1434bce6b4ff01b98d214966d3b41f701affa7f6',
    edits: [[
      '  @Field var bufferedPosition: Double = .0\n) : VideoEventPayload',
      '  @Field var bufferedPosition: Double = .0,\n  @Field var videoQueuedFrames: Int? = null,\n  @Field var videoRenderedFrames: Int? = null,\n  @Field var videoDroppedFrames: Int? = null\n) : VideoEventPayload',
    ]],
  },
  'player/VideoPlayer.kt': {
    hash: '9566638fc2d638843bbfae7d4b3a7cd1826578d5019491b221cc9c0d3f3d7b8a',
    edits: [[
      '    .forceEnableMediaCodecAsynchronousQueueing()',
      '    .apply {\n      if (playerBuilderOptions?.norstreamSynchronousCodec == true) {\n        forceDisableMediaCodecAsynchronousQueueing()\n      } else {\n        forceEnableMediaCodecAsynchronousQueueing()\n      }\n    }',
    ], [
      '      sendEvent(PlayerEvent.TimeUpdated(updatePayload))',
      '      if (norstreamCodecOptions?.norstreamSynchronousCodec == true) {\n        player.videoDecoderCounters?.let { counters ->\n          counters.ensureUpdated()\n          updatePayload.videoQueuedFrames = counters.queuedInputBufferCount\n          updatePayload.videoRenderedFrames = counters.renderedOutputBufferCount\n          updatePayload.videoDroppedFrames = counters.droppedBufferCount\n        }\n      }\n      sendEvent(PlayerEvent.TimeUpdated(updatePayload))',
    ], [
      '  private val listeners: MutableList<WeakReference<VideoPlayerListener>>',
      '  private val norstreamCodecOptions = playerBuilderOptions\n  private val listeners: MutableList<WeakReference<VideoPlayerListener>>',
    ]],
  },
};
export function patchTvCodec(path, source) {
  const spec = replacements[path];
  if (!spec) throw new Error(`Ukendt expo-video fil: ${path}`);
  const digest = (text) => createHash('sha256').update(text).digest('hex');
  if (digest(source) === spec.hash) {
    let patched = source;
    for (const [before, after] of spec.edits) {
      if (patched.split(before).length !== 2) throw new Error(`Tvetydig expo-video patch: ${path}`);
      patched = patched.replace(before, after);
    }
    return patched;
  }
  let upstream = source;
  for (const [before, after] of [...spec.edits].reverse()) upstream = upstream.replace(after, before);
  if (digest(upstream) === spec.hash && patchTvCodec(path, upstream) === source) return source;
  throw new Error(`Ukendt expo-video kode: ${path}; kontroller patchen foer build`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const files = await Promise.all(Object.keys(replacements).map(async (path) => {
    const url = new URL(`../node_modules/expo-video/android/src/main/java/expo/modules/video/${path}`, import.meta.url);
    return { url, patched: patchTvCodec(path, await readFile(url, 'utf8')) };
  }));
  for (const { url, patched } of files) await writeFile(url, patched);
  console.log('Expo-video: opt-in synkron TV-codec og sikre videotaellere klargjort');
}

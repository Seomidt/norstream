import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const replacements = {
  "player/VideoPlayerLoadControl.kt": {
    "hash": "2f9a36850c847d8020c8e00c1e3c08c69b0793c5c47cafad0cc35ea03b32c5f9",
    "edits": [
      [
        "  fun applyBufferOptions(bufferOptions: BufferOptions) {",
        "  override fun shouldContinuePreloading(\n    playerId: androidx.media3.exoplayer.analytics.PlayerId,\n    timeline: androidx.media3.common.Timeline,\n    mediaPeriodId: androidx.media3.exoplayer.source.MediaSource.MediaPeriodId,\n    bufferedDurationUs: Long\n  ): Boolean {\n    // Samme byte-budget for nuvaerende og naeste stykke; ingen RAM-vaekst.\n    val belowBudget = targetBufferBytesOverwrite == C.LENGTH_UNSET ||\n      getAllocator(playerId).totalBytesAllocated < targetBufferBytesOverwrite\n    return belowBudget && super.shouldContinuePreloading(playerId, timeline, mediaPeriodId, bufferedDurationUs)\n  }\n\n  fun applyBufferOptions(bufferOptions: BufferOptions) {"
      ]
    ]
  },
  "records/PlayerBuilderOptions.kt": {
    "hash": "96d1f644839240ccd3d2e77ab1556d54a0fb9d2a71d76b8e25a0d041b20f8056",
    "edits": [
      [
        "  @Field var seekForwardIncrement: Duration? = null",
        "  @Field var seekForwardIncrement: Duration? = null,\n  @Field var norstreamSynchronousCodec: Boolean = false"
      ]
    ]
  },
  "records/VideoEventPayloads.kt": {
    "hash": "694cd0535a758823166b07fb1434bce6b4ff01b98d214966d3b41f701affa7f6",
    "edits": [
      [
        "  @Field var bufferedPosition: Double = .0\n) : VideoEventPayload",
        "  @Field var bufferedPosition: Double = .0,\n  @Field var videoQueuedFrames: Int? = null,\n  @Field var videoRenderedFrames: Int? = null,\n  @Field var videoDroppedFrames: Int? = null\n) : VideoEventPayload"
      ]
    ]
  },
  "player/VideoPlayer.kt": {
    "hash": "9566638fc2d638843bbfae7d4b3a7cd1826578d5019491b221cc9c0d3f3d7b8a",
    "edits": [
      [
        "    .forceEnableMediaCodecAsynchronousQueueing()",
        "    .apply {\n      if (playerBuilderOptions?.norstreamSynchronousCodec == true) {\n        forceDisableMediaCodecAsynchronousQueueing()\n        experimentalSetEnableMediaCodecVideoRendererPrewarming(true)\n      } else {\n        forceEnableMediaCodecAsynchronousQueueing()\n      }\n    }"
      ],
      [
        "      sendEvent(PlayerEvent.TimeUpdated(updatePayload))",
        "      if (norstreamCodecOptions?.norstreamSynchronousCodec == true) {\n        player.videoDecoderCounters?.let { counters ->\n          counters.ensureUpdated()\n          updatePayload.videoQueuedFrames = counters.queuedInputBufferCount\n          updatePayload.videoRenderedFrames = counters.renderedOutputBufferCount\n          updatePayload.videoDroppedFrames = counters.droppedBufferCount\n        }\n      }\n      sendEvent(PlayerEvent.TimeUpdated(updatePayload))"
      ],
      [
        "  private val listeners: MutableList<WeakReference<VideoPlayerListener>>",
        "  private val norstreamCodecOptions = playerBuilderOptions\n  private val listeners: MutableList<WeakReference<VideoPlayerListener>>"
      ],
      [
        "  internal val firstFrameEventGenerator: FirstFrameEventGenerator",
        "  val norstreamArchiveQueue = NorstreamArchiveQueue(context, player) { phase, lead, overlap, transitions ->\n    emit(\"norstreamArchive\", mapOf(\"phase\" to phase, \"leadSeconds\" to lead, \"overlapSeconds\" to overlap, \"transitions\" to transitions))\n  }\n  internal val firstFrameEventGenerator: FirstFrameEventGenerator"
      ],
      [
        "    override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {",
        "    override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {\n      if (norstreamArchiveQueue.transition(mediaItem, reason)) return"
      ],
      [
        "    val newSource = uncommittedSource",
        "    val newSource = uncommittedSource\n    norstreamArchiveQueue.start(newSource)"
      ],
      [
        "      firstFrameEventGenerator.release()",
        "      norstreamArchiveQueue.cancel()\n      firstFrameEventGenerator.release()"
      ],
      [
        "    duration = player.duration / 1000f",
        "    duration = (if (norstreamArchiveQueue.enabled) norstreamArchiveQueue.durationMs else player.duration) / 1000f"
      ],
      [
        "      return player.bufferedPosition / 1000.0",
        "      return (if (norstreamArchiveQueue.enabled) norstreamArchiveQueue.bufferedPositionMs else player.bufferedPosition) / 1000.0"
      ],
      [
        "      val updatePayload = TimeUpdate(player.currentPosition / 1000.0,",
        "      val updatePayload = TimeUpdate((if (norstreamArchiveQueue.enabled) norstreamArchiveQueue.positionMs else player.currentPosition) / 1000.0,"
      ]
    ]
  }
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

package expo.modules.video.player

import android.content.Context
import android.net.Uri
import android.os.Handler
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.common.Timeline
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.analytics.AnalyticsListener
import androidx.media3.exoplayer.source.LoadEventInfo
import androidx.media3.exoplayer.source.MediaLoadData
import expo.modules.video.records.VideoSource
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone

/** En native koe med hoejst to stykker og kun én aaben HTTP-medieforbindelse.
 * Koedannelse sker efter LoadCompleted: den gamle upstream er allerede lukket,
 * mens sample-koeerne stadig spiller. Intet replace(), pause() eller nyt view. */
@UnstableApi
class NorstreamArchiveQueue(
  private val context: Context,
  private val player: ExoPlayer,
  private val nowMs: () -> Long = System::currentTimeMillis,
  private val report: (String, Double, Double, Int) -> Unit
) : AnalyticsListener {
  private data class Segment(val source: VideoSource, val fromMs: Long, val clipMs: Long, var downloaded: Boolean = false, var durationAttempts: Int = 0)
  private val handler = Handler(player.applicationLooper)
  private val segments = linkedMapOf<String, Segment>()
  private var original: VideoSource? = null
  private var initialFromMs = 0L
  private var stopMs = 0L
  private var currentId = ""
  private var generation = 0
  private var transitions = 0
  private var waiting = false
  private var lastReachedMs = Long.MIN_VALUE
  private var emptySegments = 0
  private var blocked = false
  val enabled: Boolean get() = original != null

  init { player.addAnalyticsListener(this) }

  // Den virtuelle tid er sammenhaengende over de native medieelementer.
  // JS gemmer derfor stadig positioner relativt til det foerste arkivminut.
  private val offsetMs: Long get() = segments[currentId]?.let { it.fromMs + it.clipMs - initialFromMs } ?: 0L
  val positionMs: Long get() = player.currentPosition + offsetMs
  val bufferedPositionMs: Long get() = positionMs + player.totalBufferedDuration
  val durationMs: Long get() = stopMs - initialFromMs
  fun seekPositionMs(position: Long): Long = (position - offsetMs).coerceAtLeast(0)

  fun cancel() {
    generation += 1
    handler.removeCallbacksAndMessages(null)
    original = null
    segments.clear()
    currentId = ""
    waiting = false
    blocked = false
  }

  fun start(source: VideoSource?) {
    cancel()
    transitions = 0
    lastReachedMs = Long.MIN_VALUE
    emptySegments = 0
    player.setPreloadConfiguration(ExoPlayer.PreloadConfiguration.DEFAULT)
    val options = source?.norstreamArchive ?: return
    val from = options["startMs"] ?: return
    val stop = options["stopMs"] ?: return
    val offset = options["offsetMinutes"] ?: return
    val path = source.uri?.path.orEmpty()
    val ts = path.endsWith("/timeshift.php") || (path.contains("/timeshift/") && path.endsWith(".ts"))
    if (!ts || source.drm != null || !from.isFinite() || !stop.isFinite() || stop <= from || stop - from > 172_800_000 || !offset.isFinite() || offset < -720 || offset > 840) return
    initialFromMs = from.toLong()
    stopMs = stop.toLong()
    original = source
    currentId = source.toMediaItem(context).mediaId
    segments[currentId] = Segment(source, initialFromMs, 0)
    player.setPreloadConfiguration(ExoPlayer.PreloadConfiguration(10_000_000L))
  }

  override fun onLoadCompleted(eventTime: AnalyticsListener.EventTime, loadEventInfo: LoadEventInfo, mediaLoadData: MediaLoadData) {
    if (!enabled || mediaLoadData.dataType != C.DATA_TYPE_MEDIA || eventTime.windowIndex !in 0 until eventTime.timeline.windowCount) return
    val window = eventTime.timeline.getWindow(eventTime.windowIndex, Timeline.Window())
    val segment = segments[window.mediaItem.mediaId] ?: return
    segment.downloaded = true
    // Tidslinjens endelige varighed kommer fra extractorens faktiske EOF,
    // aldrig fra den bestilte minutlaengde eller et nuvaerende afspilningsur.
    schedule(generation, 0)
  }

  /** Expo maa ikke nulstille status, undertekster eller metadata ved et
   * internt koeskift; kilden er stadig den samme start-forfra-session. */
  fun transition(item: MediaItem?, reason: Int): Boolean {
    if (!enabled || reason != Player.MEDIA_ITEM_TRANSITION_REASON_AUTO || item == null || item.mediaId !in segments) return false
    currentId = item.mediaId
    transitions += 1
    val segment = segments.getValue(currentId)
    report("overgang", player.totalBufferedDuration / 1000.0, segment.clipMs / 1000.0, transitions)
    val activeGeneration = generation
    handler.post {
      if (activeGeneration != generation) return@post
      // Frigiv gamle sample-koeer; lange udsendelser maa ikke vokse i RAM.
      val current = player.currentMediaItemIndex
      if (current > 0) player.removeMediaItems(0, current)
      segments.keys.retainAll(setOf(currentId))
      queueNext(activeGeneration)
    }
    return true
  }

  private fun schedule(activeGeneration: Int, delayMs: Long) {
    if (waiting) return
    waiting = true
    handler.postDelayed({
      waiting = false
      if (activeGeneration == generation) queueNext(activeGeneration)
    }, delayMs)
  }

  private fun queueNext(activeGeneration: Int) {
    if (blocked) return
    try {
      queueNextChecked(activeGeneration)
    } catch (_: Exception) {
      // En fejl i forberedelsen maa ikke stoppe den allerede spillende buffer.
      // Bevar det virtuelle ur; JS kan genforbinde fra samme position ved EOF.
      blocked = true
      player.setPreloadConfiguration(ExoPlayer.PreloadConfiguration.DEFAULT)
      report("tilbagefald", 0.0, 0.0, transitions)
    }
  }

  private fun queueNextChecked(activeGeneration: Int) {
    val base = original ?: return
    if (player.playbackState == Player.STATE_ENDED) return
    if (activeGeneration != generation || segments.size >= 2) return
    val segment = segments[currentId] ?: return
    if (!segment.downloaded) return
    val index = player.currentMediaItemIndex
    if (index < 0 || index >= player.currentTimeline.windowCount) return
    val window = player.currentTimeline.getWindow(index, Timeline.Window())
    if (window.mediaItem.mediaId != currentId) return
    val duration = window.durationMs
    if (duration == C.TIME_UNSET || duration <= 0) {
      if (segment.durationAttempts++ < 5) { schedule(activeGeneration, 100); return }
      // Kilden kan ikke beskrives sikkert: JS bevarer den eksisterende
      // EOF-genforbindelse fra den faktisk afspillede position.
      report("tilbagefald", 0.0, 0.0, transitions)
      return
    }
    val reached = segment.fromMs + segment.clipMs + duration
    if (reached >= stopMs - 2000) return
    if (reached <= lastReachedMs + 1000 && lastReachedMs != Long.MIN_VALUE) {
      emptySegments += 1
      if (emptySegments >= 2) { report("tilbagefald", 0.0, 0.0, transitions); return }
    } else emptySegments = 0
    val available = minOf(stopMs, nowMs() - 90_000)
    val from = reached / 60_000 * 60_000
    val complete = stopMs <= nowMs() - 90_000
    val minutes = if (complete) (available - from + 59_999) / 60_000 else (available - from) / 60_000
    val clip = reached - from
    if (minutes < 1 || clip >= minutes * 60_000 - 1000) {
      report("afventer", player.totalBufferedDuration / 1000.0, clip / 1000.0, transitions)
      schedule(activeGeneration, 15_000)
      return
    }
    val uri = nextUri(base.uri ?: return, from, minutes, base.norstreamArchive?.get("offsetMinutes")?.toLong() ?: 0) ?: return
    val options = base.norstreamArchive.orEmpty() + mapOf("startMs" to from.toDouble(), "clipMs" to clip.toDouble())
    val next = VideoSource(uri = uri, headers = base.headers, metadata = base.metadata, contentType = base.contentType, norstreamArchive = options)
    val nextSource = next.toMediaSource(context) ?: return
    segments[next.toMediaItem(context).mediaId] = Segment(next, from, clip)
    lastReachedMs = reached
    player.addMediaSource(nextSource)
    report("koesat", player.totalBufferedDuration / 1000.0, clip / 1000.0, transitions)
  }

  private fun nextUri(uri: Uri, fromMs: Long, minutes: Long, offsetMinutes: Long): Uri? {
    val date = SimpleDateFormat("yyyy-MM-dd:HH-mm", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }
      .format(java.util.Date(fromMs + offsetMinutes * 60_000))
    if (uri.path.orEmpty().endsWith("/timeshift.php")) {
      val builder = uri.buildUpon().clearQuery()
      for (key in uri.queryParameterNames) {
        for (value in uri.getQueryParameters(key)) builder.appendQueryParameter(key, when (key) { "start" -> date; "duration" -> minutes.toString(); else -> value })
      }
      return builder.build()
    }
    val path = uri.encodedPath ?: return null
    val pattern = Regex("(/timeshift/[^/]+/[^/]+/)[0-9]+/[^/]+/")
    val match = pattern.find(path) ?: return null
    return uri.buildUpon().encodedPath(path.replaceRange(match.range, match.groupValues[1] + minutes + "/" + date + "/")).build()
  }
}

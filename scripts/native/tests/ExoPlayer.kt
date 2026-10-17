package androidx.media3.exoplayer
import androidx.media3.common.Timeline
import androidx.media3.exoplayer.analytics.AnalyticsListener
import androidx.media3.exoplayer.source.MediaSource
class ExoPlayer {
  val applicationLooper = Any()
  var currentPosition = 0L
  var totalBufferedDuration = 90_000L
  var currentMediaItemIndex = 0
  var currentTimeline = Timeline(mutableListOf())
  var playbackState = 3
  var upstreamOpen = false
  val added = mutableListOf<MediaSource>()
  fun setPreloadConfiguration(config: PreloadConfiguration) {}
  fun addAnalyticsListener(listener: AnalyticsListener) {}
  fun addMediaSource(source: MediaSource) {
    check(!upstreamOpen) { "To samtidige upstreams" }
    added.add(source)
    currentTimeline.entries.add(Timeline.Window(source.source.toMediaItem(android.content.Context())))
  }
  fun removeMediaItems(from: Int, until: Int) {
    currentTimeline.entries.subList(from, until).clear()
    currentMediaItemIndex -= until - from
  }
  class PreloadConfiguration(duration: Long) { companion object { val DEFAULT = PreloadConfiguration(-1) } }
}

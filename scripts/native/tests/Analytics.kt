package androidx.media3.exoplayer.analytics
import androidx.media3.common.Timeline
import androidx.media3.exoplayer.source.LoadEventInfo
import androidx.media3.exoplayer.source.MediaLoadData
interface AnalyticsListener {
  class EventTime(val timeline: Timeline, val windowIndex: Int)
  fun onLoadCompleted(eventTime: EventTime, info: LoadEventInfo, data: MediaLoadData) {}
}

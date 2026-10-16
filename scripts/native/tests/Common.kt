package androidx.media3.common
object C { const val DATA_TYPE_MEDIA = 1; const val TIME_UNSET = -9223372036854775807L }
class MediaItem(val mediaId: String)
object Player { const val MEDIA_ITEM_TRANSITION_REASON_AUTO = 1; const val STATE_ENDED = 4 }
class Timeline(val entries: MutableList<Window>) {
  val isEmpty get() = entries.isEmpty()
  val windowCount get() = entries.size
  fun getWindow(index: Int, into: Window): Window = entries[index]
  class Window(val mediaItem: MediaItem = MediaItem(""), val durationMs: Long = C.TIME_UNSET)
}

package expo.modules.video.records
import android.content.Context
import android.net.Uri
import androidx.media3.common.MediaItem
import androidx.media3.exoplayer.source.MediaSource
class VideoSource(val uri: Uri? = null, val headers: Map<String, String>? = null, val metadata: Any? = null, val contentType: Any? = null, val drm: Any? = null, val norstreamArchive: Map<String, Double>? = null) {
  fun toMediaItem(context: Context) = MediaItem("arkiv:${norstreamArchive?.get("token")}:${norstreamArchive?.get("startMs")}:${norstreamArchive?.get("clipMs")}")
  fun toMediaSource(context: Context) = MediaSource(this)
}

package dk.seomidt.norradio.auto

import android.content.ComponentName
import android.os.Handler
import android.os.Looper
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import com.google.common.util.concurrent.ListenableFuture
import com.google.common.util.concurrent.MoreExecutors
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONObject

/**
 * Broen fra JavaScript til RadioAutoService: appen spiller, holder pause
 * og skriver biblioteket gennem den, og faar tilstanden som haendelser —
 * ogsaa naar det er bilen der skiftede station.
 */
class RadioAutoModule : Module() {
  private var controllerFuture: ListenableFuture<MediaController>? = null
  private var controller: MediaController? = null
  private val main = Handler(Looper.getMainLooper())

  private val listener =
    object : Player.Listener {
      override fun onPlaybackStateChanged(playbackState: Int) = emit()
      override fun onIsPlayingChanged(isPlaying: Boolean) = emit()
      override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) = emit()
      override fun onPlayerError(error: PlaybackException) = emit(error.message)
    }

  override fun definition() = ModuleDefinition {
    Name("RadioAuto")
    Events("onState")

    OnCreate { connect() }
    OnDestroy {
      controller?.removeListener(listener)
      controllerFuture?.let { MediaController.releaseFuture(it) }
      controller = null
      controllerFuture = null
    }

    AsyncFunction("setLibrary") { json: String ->
      val context = appContext.reactContext ?: throw IllegalStateException("Ingen kontekst")
      Library.write(context, json)
    }

    AsyncFunction("play") { json: String ->
      val station = Library.station(JSONObject(json)) ?: throw IllegalArgumentException("Stationen mangler adresse")
      withController { c ->
        c.setMediaItem(Library.item(station))
        c.prepare()
        c.play()
      }
    }

    AsyncFunction("pause") { withController { it.pause() } }
    AsyncFunction("resume") { withController { it.play() } }
    AsyncFunction("stop") { withController { it.stop() } }

    Function("current") { snapshot() }
  }

  private fun connect() {
    val context = appContext.reactContext ?: return
    val token = SessionToken(context, ComponentName(context, RadioAutoService::class.java))
    val future = MediaController.Builder(context, token).buildAsync()
    controllerFuture = future
    future.addListener(
      {
        try {
          val c = future.get()
          controller = c
          c.addListener(listener)
          emit()
        } catch (_: Exception) {
          // Tjenesten kom ikke op; naeste kald proever igen.
          controllerFuture = null
        }
      },
      MoreExecutors.directExecutor(),
    )
  }

  private fun withController(action: (MediaController) -> Unit) {
    main.post {
      val c = controller
      if (c != null) {
        action(c)
        return@post
      }
      if (controllerFuture == null) connect()
      val future = controllerFuture ?: return@post
      future.addListener({ controller?.let { main.post { action(it) } } }, MoreExecutors.directExecutor())
    }
  }

  private fun snapshot(): Map<String, Any?> {
    val c = controller
    val item = c?.currentMediaItem
    val state =
      when {
        c == null -> "idle"
        c.playerError != null -> "error"
        c.playbackState == Player.STATE_BUFFERING -> "connecting"
        c.playbackState == Player.STATE_READY && c.isPlaying -> "playing"
        c.playbackState == Player.STATE_READY -> "paused"
        c.playbackState == Player.STATE_IDLE && item != null -> "error"
        else -> "idle"
      }
    return mapOf(
      "state" to state,
      "stationId" to item?.mediaId?.removePrefix(Library.STATION_PREFIX),
      "title" to item?.mediaMetadata?.title?.toString(),
      "message" to c?.playerError?.message,
    )
  }

  private fun emit(message: String? = null) {
    val map = HashMap(snapshot())
    if (message != null) map["message"] = message
    try {
      sendEvent("onState", map)
    } catch (_: Exception) {
      // JavaScript er vaek (appen lukket). Tjenesten spiller videre alligevel.
    }
  }
}

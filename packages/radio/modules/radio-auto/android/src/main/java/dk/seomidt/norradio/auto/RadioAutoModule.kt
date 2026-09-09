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
 *
 * MediaController maa kun roeres fra hovedtraaden. Alt der laeser eller
 * styrer den gaar derfor gennem `main`, og JavaScript faar tilstanden fra
 * det sidste oejebliksbillede (`last`), aldrig direkte fra controlleren.
 */
class RadioAutoModule : Module() {
  private var controllerFuture: ListenableFuture<MediaController>? = null
  private var controller: MediaController? = null
  private val main = Handler(Looper.getMainLooper())

  /** Det JavaScript ser. Skrives kun paa hovedtraaden, laeses fra JS-traaden. */
  @Volatile private var last: Map<String, Any?> = idle()

  private val listener =
    object : Player.Listener {
      override fun onPlaybackStateChanged(playbackState: Int) = emit()
      override fun onIsPlayingChanged(isPlaying: Boolean) = emit()
      override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) = emit()
      override fun onPlayerError(error: PlaybackException) = emit(ERROR_TEXT)
    }

  override fun definition() = ModuleDefinition {
    Name("RadioAuto")
    Events("onState")

    OnCreate { main.post { connect() } }
    OnDestroy {
      main.post {
        controller?.removeListener(listener)
        controllerFuture?.let { MediaController.releaseFuture(it) }
        controller = null
        controllerFuture = null
      }
    }

    AsyncFunction("setLibrary") { json: String ->
      val context = appContext.reactContext ?: throw IllegalStateException("Ingen kontekst")
      Library.write(context, json)
    }

    AsyncFunction("play") { json: String ->
      val context = appContext.reactContext ?: throw IllegalStateException("Ingen kontekst")
      val station = Library.station(JSONObject(json)) ?: throw IllegalArgumentException("Stationen mangler adresse")
      withController { c ->
        c.setMediaItem(Library.item(station, context))
        c.prepare()
        c.play()
      }
    }

    AsyncFunction("pause") { withController { it.pause() } }
    AsyncFunction("resume") { withController { it.play() } }
    AsyncFunction("stop") { withController { it.stop() } }

    Function("current") { last }
  }

  private fun connect() {
    val context = appContext.reactContext ?: return
    val token = SessionToken(context, ComponentName(context, RadioAutoService::class.java))
    val future = MediaController.Builder(context, token).buildAsync()
    controllerFuture = future
    future.addListener(
      {
        main.post {
          try {
            val c = future.get()
            controller = c
            c.addListener(listener)
            emit()
          } catch (_: Exception) {
            // Tjenesten kom ikke op; naeste kald proever igen.
            if (controllerFuture === future) controllerFuture = null
          }
        }
      },
      MoreExecutors.directExecutor(),
    )
  }

  private fun withController(action: (MediaController) -> Unit) {
    main.post {
      val c = controller
      if (c != null) {
        runSafely { action(c) }
        return@post
      }
      if (controllerFuture == null) connect()
      val future = controllerFuture ?: return@post
      future.addListener({ main.post { controller?.let { runSafely { action(it) } } } }, MoreExecutors.directExecutor())
    }
  }

  /** En fejl i afspilleren maa aldrig lukke appen; den bliver til en tilstand. */
  private fun runSafely(action: () -> Unit) {
    try {
      action()
    } catch (_: Exception) {
      emit(ERROR_TEXT)
    }
  }

  /** Kun fra hovedtraaden. */
  private fun snapshot(): Map<String, Any?> {
    val c = controller ?: return idle()
    val item = c.currentMediaItem
    val state =
      when {
        c.playerError != null -> "error"
        c.playbackState == Player.STATE_BUFFERING -> "connecting"
        c.playbackState == Player.STATE_READY && c.isPlaying -> "playing"
        c.playbackState == Player.STATE_READY -> "paused"
        c.playbackState == Player.STATE_IDLE && item != null -> "error"
        else -> "idle"
      }
    val meta = item?.mediaMetadata
    val extras = meta?.extras
    return mapOf(
      "state" to state,
      "stationId" to item?.mediaId?.removePrefix(Library.STATION_PREFIX),
      // Stationens navn, ogsaa naar en sang er skrevet ind som titel.
      "title" to (extras?.getString(Library.META_STATION) ?: meta?.title?.toString()),
      "artist" to extras?.getString(Library.META_ARTIST),
      "track" to extras?.getString(Library.META_TRACK),
      "coverUrl" to extras?.getString(Library.META_COVER),
      "message" to if (c.playerError != null) ERROR_TEXT else null,
    )
  }

  private fun emit(message: String? = null) {
    val map = HashMap(snapshot())
    if (message != null) {
      map["message"] = message
      map["state"] = "error"
    }
    last = map
    try {
      sendEvent("onState", map)
    } catch (_: Exception) {
      // JavaScript er vaek (appen lukket). Tjenesten spiller videre alligevel.
    }
  }

  private companion object {
    /** Adressen kan staa i afspillerens egen fejltekst; den viser vi ikke. */
    const val ERROR_TEXT = "Streamen kunne ikke afspilles"

    fun idle(): Map<String, Any?> =
      mapOf("state" to "idle", "stationId" to null, "title" to null, "artist" to null, "track" to null, "coverUrl" to null, "message" to null)
  }
}

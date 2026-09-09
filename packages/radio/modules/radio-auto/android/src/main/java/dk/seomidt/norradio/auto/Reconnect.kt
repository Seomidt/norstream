package dk.seomidt.norradio.auto

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.os.Handler
import androidx.media3.common.C
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.datasource.HttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.upstream.DefaultLoadErrorHandlingPolicy
import androidx.media3.exoplayer.upstream.LoadErrorHandlingPolicy
import java.io.IOException
import kotlin.math.min

/**
 * Radioen skal selv komme tilbage naar mobildaekningen har vaeret vaek.
 *
 * Foerste lag er afspillerens egne hentninger: ExoPlayer opgiver normalt
 * en live-stream efter seks fejlslagne forsoeg, og saa er det slut. Her
 * bliver den ved i op til ti minutter med stigende pauser, saa et kort
 * hul i daekningen bare er et hul i lyden. En stream der svarer 4xx er
 * doed og faar ikke flere forsoeg.
 */
class PatientLoadErrors : DefaultLoadErrorHandlingPolicy() {
  override fun getRetryDelayMsFor(loadErrorInfo: LoadErrorHandlingPolicy.LoadErrorInfo): Long {
    val cause = loadErrorInfo.exception
    if (cause is HttpDataSource.InvalidResponseCodeException && cause.responseCode in 400..499) return C.TIME_UNSET
    if (cause !is IOException) return C.TIME_UNSET
    return min(1000L shl loadErrorInfo.errorCount.coerceIn(0, 4), MAX_DELAY_MS)
  }

  override fun getMinimumLoadableRetryCount(dataType: Int): Int = MAX_ATTEMPTS

  private companion object {
    const val MAX_DELAY_MS = 15_000L
    /** Med pauser paa op til 15 sekunder er det omkring ti minutter. */
    const val MAX_ATTEMPTS = 40
  }
}

/**
 * Andet lag: falder afspilleren alligevel ud — fejl, eller en live-stream
 * der "sluttede" fordi serveren lukkede forbindelsen — starter den igen
 * med stigende pauser, saa laenge brugeren stadig vil hoere radio. Melder
 * telefonen at nettet er tilbage, proeves der med det samme i stedet for
 * at vente pausen ud. Trykker brugeren selv pause eller stop, stopper
 * forsoegene.
 */
class Reconnect(context: Context, private val player: ExoPlayer, private val main: Handler) : Player.Listener {
  private val connectivity = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
  /** Vil brugeren hoere radio lige nu? Saettes af afspil, ryddes af pause/stop fra brugeren. */
  private var wanted = false
  private var attempt = 0
  private var pending: Runnable? = null
  /** Sand naar forsoegene er opgivet; et nyt net saetter dem i gang igen. */
  private var gaveUp = false

  private val networkCallback =
    object : ConnectivityManager.NetworkCallback() {
      override fun onAvailable(network: Network) {
        main.post {
          if (wanted && (pending != null || gaveUp)) {
            attempt = 0
            gaveUp = false
            retryNow()
          }
        }
      }
    }

  fun start() {
    player.addListener(this)
    try {
      connectivity?.registerDefaultNetworkCallback(networkCallback)
    } catch (_: Exception) {
      // Uden besked fra nettet gaelder pauserne alene.
    }
  }

  fun stop() {
    cancel()
    player.removeListener(this)
    try {
      connectivity?.unregisterNetworkCallback(networkCallback)
    } catch (_: Exception) {
      // Var ikke registreret.
    }
  }

  override fun onPlayWhenReadyChanged(playWhenReady: Boolean, reason: Int) {
    if (playWhenReady) {
      wanted = true
      gaveUp = false
      return
    }
    // Pause fra brugeren, eller hovedtelefonerne trukket ud: saa skal der vaere stille.
    if (reason == Player.PLAY_WHEN_READY_CHANGE_REASON_USER_REQUEST ||
      reason == Player.PLAY_WHEN_READY_CHANGE_REASON_AUDIO_BECOMING_NOISY ||
      reason == Player.PLAY_WHEN_READY_CHANGE_REASON_END_OF_MEDIA_ITEM
    ) {
      wanted = false
      cancel()
    }
  }

  override fun onIsPlayingChanged(isPlaying: Boolean) {
    if (isPlaying) {
      attempt = 0
      gaveUp = false
      cancel()
    }
  }

  override fun onPlayerError(error: PlaybackException) {
    if (wanted && retryable(error)) schedule()
  }

  override fun onPlaybackStateChanged(playbackState: Int) {
    // En live-stream slutter ikke; "slut" betyder at serveren lukkede.
    if (playbackState == Player.STATE_ENDED && wanted && player.mediaItemCount > 0) schedule()
  }

  /** Netvaerk og timeouts proeves igen; en doed adresse, et ukendt format eller en manglende dekoder goer ikke. */
  private fun retryable(error: PlaybackException): Boolean {
    val cause = error.cause
    if (cause is HttpDataSource.InvalidResponseCodeException && cause.responseCode in 400..499) return false
    return when (error.errorCode) {
      PlaybackException.ERROR_CODE_PARSING_CONTAINER_MALFORMED,
      PlaybackException.ERROR_CODE_PARSING_MANIFEST_MALFORMED,
      PlaybackException.ERROR_CODE_PARSING_CONTAINER_UNSUPPORTED,
      PlaybackException.ERROR_CODE_PARSING_MANIFEST_UNSUPPORTED,
      PlaybackException.ERROR_CODE_DECODER_INIT_FAILED,
      PlaybackException.ERROR_CODE_DECODING_FORMAT_UNSUPPORTED,
      PlaybackException.ERROR_CODE_IO_FILE_NOT_FOUND,
      PlaybackException.ERROR_CODE_IO_NO_PERMISSION,
      -> false
      else -> true
    }
  }

  private fun schedule() {
    cancel()
    if (attempt >= MAX_ATTEMPTS) {
      gaveUp = true
      return
    }
    attempt++
    val delay = min(FIRST_DELAY_MS shl (attempt - 1).coerceIn(0, 4), MAX_DELAY_MS)
    val task = Runnable {
      pending = null
      retryNow()
    }
    pending = task
    main.postDelayed(task, delay)
  }

  private fun retryNow() {
    cancel()
    if (!wanted || player.mediaItemCount == 0) return
    try {
      player.seekToDefaultPosition()
      player.prepare()
      player.play()
    } catch (_: Exception) {
      schedule()
    }
  }

  private fun cancel() {
    pending?.let { main.removeCallbacks(it) }
    pending = null
  }

  private companion object {
    const val FIRST_DELAY_MS = 2_000L
    const val MAX_DELAY_MS = 30_000L
    /** Med pauser paa op til 30 sekunder er det et kvarters tid; derefter venter den paa et nyt net. */
    const val MAX_ATTEMPTS = 30
  }
}

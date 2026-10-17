package dk.seomidt.norradio.auto

import android.os.SystemClock
import androidx.media3.common.ForwardingPlayer
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer

/**
 * Radio er live: efter en pause skal den starte paa live, ikke spille den
 * gamle buffer.
 *
 * Mens der er pause, bliver afspilleren ved med at hente lyd ind til
 * bufferen er fuld, og saa lukker serveren typisk forbindelsen. Trykker man
 * afspil, spillede den den gamle lyd faerdig, og naar den ramte hullet,
 * hoppede den til live — det der "springer rundt". Appens egen afspil-knap
 * gik allerede til live, men bilen, rattet, Bluetooth og notifikationen
 * trykker afspil direkte paa afspilleren. Derfor ligger det her, i den
 * afspiller sessionen faar, saa det gaelder for alle knapper.
 *
 * Er der holdt pause (af hvem som helst: brugeren, bilen, Bluetooth der
 * blev afbrudt), kastes bufferen, og der forbindes forfra ved live-kanten.
 * Det samme naar lyden har vaeret holdt tilbage en tid (et opkald).
 */
class LivePlayer(private val exo: ExoPlayer) : ForwardingPlayer(exo) {
  /** Sat naar afspilningen er sat paa pause: saa er bufferen gammel. */
  private var stale = false
  /** Hvornaar lyden blev holdt tilbage (opkald o.l.), eller null. */
  private var suppressedAt: Long? = null
  /** Stationen der spiller, saa et skift til en ny station ikke tages for en pause. */
  private var lastMediaId: String? = null

  private val watcher =
    object : Player.Listener {
      override fun onPlayWhenReadyChanged(playWhenReady: Boolean, reason: Int) {
        stale = !playWhenReady && exo.mediaItemCount > 0
      }

      override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
        // Sangtitler skrives ind i samme element (samme id); det er ikke en ny station.
        val id = mediaItem?.mediaId
        if (id != lastMediaId) {
          lastMediaId = id
          stale = false
        }
      }

      override fun onPlaybackSuppressionReasonChanged(playbackSuppressionReason: Int) {
        if (playbackSuppressionReason != Player.PLAYBACK_SUPPRESSION_REASON_NONE) {
          if (suppressedAt == null) suppressedAt = SystemClock.elapsedRealtime()
          return
        }
        val since = suppressedAt ?: return
        suppressedAt = null
        val held = SystemClock.elapsedRealtime() - since
        if (exo.playWhenReady && exo.mediaItemCount > 0 && held >= SUPPRESSED_STALE_MS) {
          AutoLog.add("lyden var holdt tilbage i ${held / 1000} s; tilbage til live")
          exo.seekToDefaultPosition()
        }
      }
    }

  init {
    exo.addListener(watcher)
  }

  override fun play() {
    goLive()
    super.play()
  }

  override fun setPlayWhenReady(playWhenReady: Boolean) {
    if (playWhenReady) goLive()
    super.setPlayWhenReady(playWhenReady)
  }

  /** Efter en pause: kast den gamle buffer og forbind forfra ved live-kanten. */
  private fun goLive() {
    if (!stale || exo.playWhenReady || exo.mediaItemCount == 0) return
    stale = false
    AutoLog.add("afspil efter pause: gammel buffer kasseres, starter paa live")
    exo.seekToDefaultPosition()
    if (exo.playbackState == Player.STATE_IDLE) exo.prepare()
  }

  private companion object {
    /** Kortere afbrydelser (en kort besked) fortsaetter bare; et opkald gaar til live. */
    const val SUPPRESSED_STALE_MS = 3_000L
  }
}

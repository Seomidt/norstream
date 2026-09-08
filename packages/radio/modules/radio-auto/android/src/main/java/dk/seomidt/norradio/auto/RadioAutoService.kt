package dk.seomidt.norradio.auto

import android.content.Intent
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.session.LibraryResult
import androidx.media3.session.MediaLibraryService
import androidx.media3.session.MediaSession
import com.google.common.collect.ImmutableList
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture

/**
 * Den ene afspiller: telefonens skaerm, notifikationen, rattet over
 * Bluetooth og Android Autos skaerm styrer alle den samme session her.
 *
 * Android Auto forbinder til tjenesten direkte og bladrer i biblioteket
 * gennem onGetChildren; vaelger den en station, kommer den som et
 * MediaItem med kun et id, og onAddMediaItems slaar adressen op.
 */
class RadioAutoService : MediaLibraryService() {
  private var player: ExoPlayer? = null
  private var session: MediaLibrarySession? = null

  override fun onCreate() {
    super.onCreate()
    val built =
      ExoPlayer.Builder(this)
        .setAudioAttributes(
          AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MUSIC).build(),
          true,
        )
        .setHandleAudioBecomingNoisy(true)
        .setWakeMode(C.WAKE_MODE_NETWORK)
        .build()
    player = built
    session = MediaLibrarySession.Builder(this, built, Callback(this)).build()
  }

  override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaLibrarySession? = session

  override fun onTaskRemoved(rootIntent: Intent?) {
    // Swipes appen vaek mens der spilles, spiller radioen videre. Er der
    // stille, er der ingen grund til at holde tjenesten i live.
    val p = player
    if (p == null || !p.playWhenReady || p.mediaItemCount == 0) stopSelf()
  }

  override fun onDestroy() {
    session?.release()
    player?.release()
    session = null
    player = null
    super.onDestroy()
  }

  private class Callback(private val service: RadioAutoService) : MediaLibrarySession.Callback {
    override fun onGetLibraryRoot(
      session: MediaLibrarySession,
      browser: MediaSession.ControllerInfo,
      params: LibraryParams?,
    ): ListenableFuture<LibraryResult<MediaItem>> =
      Futures.immediateFuture(LibraryResult.ofItem(Library.folder(Library.ROOT, "NorRadio"), params))

    override fun onGetChildren(
      session: MediaLibrarySession,
      browser: MediaSession.ControllerInfo,
      parentId: String,
      page: Int,
      pageSize: Int,
      params: LibraryParams?,
    ): ListenableFuture<LibraryResult<ImmutableList<MediaItem>>> {
      val children = Library.read(service).children(parentId, service)
      return Futures.immediateFuture(LibraryResult.ofItemList(ImmutableList.copyOf(children), params))
    }

    override fun onGetItem(
      session: MediaLibrarySession,
      browser: MediaSession.ControllerInfo,
      mediaId: String,
    ): ListenableFuture<LibraryResult<MediaItem>> {
      val station = Library.read(service).find(mediaId)
      return Futures.immediateFuture(
        if (station == null) LibraryResult.ofError(LibraryResult.RESULT_ERROR_BAD_VALUE)
        else LibraryResult.ofItem(Library.item(station, service), null),
      )
    }

    override fun onAddMediaItems(
      mediaSession: MediaSession,
      controller: MediaSession.ControllerInfo,
      mediaItems: MutableList<MediaItem>,
    ): ListenableFuture<MutableList<MediaItem>> {
      // Uri'en kommer aldrig med over broen. Fra appen ligger adressen i
      // requestMetadata; fra bilen kommer kun et id, som biblioteket slaar
      // op. Et element ingen af dem kender, smides vaek — et element uden
      // adresse ville faa afspilleren til at gaa ned.
      val library = Library.read(service)
      val resolved =
        mediaItems.mapNotNull { item ->
          if (item.localConfiguration != null) item
          else (Library.fromRequest(item) ?: library.find(item.mediaId))?.let { Library.item(it, service) }
        }
      return Futures.immediateFuture(resolved.toMutableList())
    }
  }
}

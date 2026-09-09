package dk.seomidt.norradio.auto

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.Metadata
import androidx.media3.common.Player
import androidx.media3.extractor.metadata.icy.IcyInfo
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.session.LibraryResult
import androidx.media3.session.MediaLibraryService
import androidx.media3.session.MediaSession
import com.google.common.collect.ImmutableList
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture
import java.util.concurrent.Callable
import java.util.concurrent.Executors

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
  private var reconnect: Reconnect? = null

  /** Hentninger fra Radio Browser, saa bilen ikke venter paa hovedtraaden. */
  val fetcher = Executors.newSingleThreadExecutor()

  /** Opslag af covers; egen traad, saa et langsomt iTunes ikke holder landelister tilbage. */
  private val covers = Executors.newSingleThreadExecutor()
  private val main = Handler(Looper.getMainLooper())

  /** Stationens egne metadata, som de var foer nogen sang blev skrevet ind. */
  private var base: MediaMetadata? = null
  /** Den sidste titel streamen sendte, saa samme linje ikke behandles to gange. */
  private var lastTitle: String? = null

  /**
   * Nu-spiller: streamen sender "Kunstner - Titel" som ICY-metadata, og
   * ExoPlayer giver den her. Elementets egne metadata gaar forud for
   * streamens i det afspilleren viser, saa titlen skrives ind i elementet
   * med replaceMediaItem — som for samme adresse ikke afbryder lyden.
   */
  private val nowPlayingListener =
    object : Player.Listener {
      override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
        // Et element vi selv har skrevet sang ind i, er ikke en ny station.
        if (mediaItem?.mediaMetadata?.extras?.containsKey(Library.META_TRACK) == true) return
        base = mediaItem?.mediaMetadata
        lastTitle = null
      }

      override fun onMetadata(metadata: Metadata) {
        for (i in 0 until metadata.length()) {
          val entry = metadata.get(i)
          if (entry is IcyInfo) entry.title?.let { onStreamTitle(it) }
        }
      }
    }

  private fun onStreamTitle(raw: String) {
    if (raw == lastTitle) return
    lastTitle = raw
    if (!AutoLog.nowPlayingEnabled(this)) return
    AutoLog.add("stream-titel: ${raw.take(80)}")
    val station = base?.title?.toString() ?: player?.currentMediaItem?.mediaMetadata?.title?.toString() ?: ""
    val playing = NowPlaying.parse(raw, station)
    apply(playing, null)
    if (playing == null) return
    covers.execute {
      val cover = Covers.lookup(playing)
      main.post { if (lastTitle == raw) apply(playing, cover) }
    }
  }

  /** Skriver sangen (eller stationen alene) ind i det element der spiller. Hovedtraaden. */
  private fun apply(playing: NowPlaying?, coverUrl: String?) {
    val p = player ?: return
    val item = p.currentMediaItem ?: return
    val original = base ?: item.mediaMetadata
    val station = original.title?.toString() ?: ""
    val logos = original.extras?.getString(Library.META_LOGOS)?.split(Library.LOGO_SEPARATOR)?.filter { it.isNotEmpty() } ?: emptyList()
    val builder = original.buildUpon()
    val extras = Bundle(original.extras ?: Bundle())
    if (playing == null) {
      extras.remove(Library.META_TRACK)
      extras.remove(Library.META_ARTIST)
      extras.remove(Library.META_COVER)
      extras.remove(Library.META_STATION)
    } else {
      builder.setTitle(playing.track).setArtist(playing.artist).setSubtitle(station).setDisplayTitle(playing.track)
      extras.putString(Library.META_STATION, station)
      extras.putString(Library.META_TRACK, playing.track)
      extras.putString(Library.META_ARTIST, playing.artist)
      if (coverUrl != null) {
        extras.putString(Library.META_COVER, coverUrl)
        builder.setArtworkUri(Artwork.uri(this, listOf(coverUrl) + logos))
      } else {
        extras.remove(Library.META_COVER)
      }
    }
    builder.setExtras(extras)
    val updated = item.buildUpon().setMediaMetadata(builder.build()).build()
    try {
      AutoLog.add("replaceMediaItem: ${playing?.let { "${it.artist} - ${it.track}" } ?: "kun station"}${if (coverUrl != null) " + cover" else ""}")
      p.replaceMediaItem(p.currentMediaItemIndex, updated)
    } catch (_: Exception) {
      // Ikke vaerd at afbryde lyden for.
    }
  }

  private companion object {
    /** Hvor mange logoer der hentes paa forhaand naar en liste gives til bilen: det foerste skaermfulde eller to. Resten hentes naar bilen beder om dem. */
    const val PREFETCH = 40
  }

  override fun onCreate() {
    super.onCreate()
    val built =
      ExoPlayer.Builder(this)
        .setMediaSourceFactory(DefaultMediaSourceFactory(this).setLoadErrorHandlingPolicy(PatientLoadErrors()))
        .setAudioAttributes(
          AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MUSIC).build(),
          true,
        )
        .setHandleAudioBecomingNoisy(true)
        .setWakeMode(C.WAKE_MODE_NETWORK)
        .build()
    built.addListener(nowPlayingListener)
    reconnect = Reconnect(this, built, main).also { it.start() }
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
    fetcher.shutdown()
    covers.shutdown()
    reconnect?.stop()
    reconnect = null
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
    ): ListenableFuture<LibraryResult<MediaItem>> {
      AutoLog.add("getLibraryRoot fra ${browser.packageName}")
      return Futures.immediateFuture(LibraryResult.ofItem(Library.folder(Library.ROOT, "NorRadio"), params))
    }

    override fun onGetChildren(
      session: MediaLibrarySession,
      browser: MediaSession.ControllerInfo,
      parentId: String,
      page: Int,
      pageSize: Int,
      params: LibraryParams?,
    ): ListenableFuture<LibraryResult<ImmutableList<MediaItem>>> {
      AutoLog.add("getChildren $parentId side=$page str=$pageSize fra ${browser.packageName}")
      val library = Library.read(service)
      if (parentId.startsWith(Library.COUNTRY_PREFIX)) {
        val code = parentId.removePrefix(Library.COUNTRY_PREFIX)
        val onPhone = library.stationsOf(code)
        if (onPhone.isNotEmpty()) {
          RadioBrowser.remember(onPhone)
          for (station in onPhone.take(PREFETCH)) Artwork.prefetch(service, station.logoUrls)
        } else {
          // Landet er ikke hentet paa telefonen: tjenesten henter det selv,
          // i baggrunden, og bilen faar listen naar den er der.
          return Futures.submit(
            Callable<LibraryResult<ImmutableList<MediaItem>>> {
              val fetched = RadioBrowser.stations(service, code)
              AutoLog.add("hentede $code selv: ${fetched.size} stationer")
              for (station in fetched.take(PREFETCH)) Artwork.prefetch(service, station.logoUrls)
              LibraryResult.ofItemList(ImmutableList.copyOf(fetched.map { Library.item(it, service) }), params)
            },
            service.fetcher,
          )
        }
      }
      if (parentId == Library.FAVOURITES) for (station in library.favourites.take(PREFETCH)) Artwork.prefetch(service, station.logoUrls)
      val children = library.children(parentId, service)
      AutoLog.add("svarer $parentId: ${children.size} elementer")
      return Futures.immediateFuture(LibraryResult.ofItemList(ImmutableList.copyOf(children), params))
    }

    override fun onGetItem(
      session: MediaLibrarySession,
      browser: MediaSession.ControllerInfo,
      mediaId: String,
    ): ListenableFuture<LibraryResult<MediaItem>> {
      AutoLog.add("getItem $mediaId")
      val station = Library.read(service).find(mediaId) ?: RadioBrowser.find(mediaId.removePrefix(Library.STATION_PREFIX))
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
      AutoLog.add("addMediaItems ${mediaItems.joinToString { it.mediaId }} fra ${controller.packageName}")
      // Uri'en kommer aldrig med over broen. Fra appen ligger adressen i
      // requestMetadata; fra bilen kommer kun et id, som biblioteket slaar
      // op. Et element ingen af dem kender, smides vaek — et element uden
      // adresse ville faa afspilleren til at gaa ned.
      val library = Library.read(service)
      val resolved =
        mediaItems.mapNotNull { item ->
          if (item.localConfiguration != null) item
          else (Library.fromRequest(item) ?: library.find(item.mediaId) ?: RadioBrowser.find(item.mediaId.removePrefix(Library.STATION_PREFIX)))
            ?.let { Library.item(it, service) }
        }
      return Futures.immediateFuture(resolved.toMutableList())
    }
  }
}

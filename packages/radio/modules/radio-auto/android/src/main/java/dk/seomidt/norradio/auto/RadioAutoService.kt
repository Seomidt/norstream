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
import androidx.media3.session.CommandButton
import androidx.media3.session.LibraryResult
import androidx.media3.session.MediaLibraryService
import androidx.media3.session.MediaSession
import androidx.media3.session.SessionCommand
import androidx.media3.session.SessionResult
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
  /** Sangen der spiller lige nu, til bogmaerket i bilen. Null naar streamen ikke siger nogen. */
  private var currentSong: NowPlaying? = null

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
    player?.currentMediaItem?.mediaId?.removePrefix(Library.STATION_PREFIX)?.let { AutoLog.rememberTitled(this, it) }
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
    if (currentSong != playing) {
      currentSong = playing
      refreshButtons()
    }
  }

  private companion object {
    /** Knappen i bilens afspilningsskaerm: favorit til/fra. */
    const val CMD_FAVOURITE = "dk.seomidt.norradio.FAVOURITE"
    /** Bogmaerket: gem den sang der spiller, til listen i appen og Spotify. */
    const val CMD_SAVE_SONG = "dk.seomidt.norradio.SAVE_SONG"
  }

  /** Stationen der spiller lige nu, som den staar i biblioteket eller blev fundet. */
  private fun currentStation(): Station? {
    val item = player?.currentMediaItem ?: return null
    val id = item.mediaId.removePrefix(Library.STATION_PREFIX)
    return Library.read(this).find(item.mediaId) ?: RadioBrowser.find(id) ?: Library.fromRequest(item)
  }

  /** Hjertet: fyldt naar stationen er favorit. Vises i bilen og i notifikationen. */
  private fun favouriteButton(): CommandButton {
    val on = currentStation()?.let { Favourites.isFavourite(this, it.id) } ?: false
    return CommandButton.Builder(if (on) CommandButton.ICON_HEART_FILLED else CommandButton.ICON_HEART_UNFILLED)
      .setDisplayName(if (on) "Fjern favorit" else "Gem som favorit")
      .setSessionCommand(SessionCommand(CMD_FAVOURITE, Bundle.EMPTY))
      .build()
  }

  /** Bogmaerket: kun naar streamen har sagt hvilken sang der spiller. Fyldt naar den er gemt. */
  private fun saveSongButton(): CommandButton? {
    val song = currentSong ?: return null
    val saved = SavedSongs.isPending(this, song)
    return CommandButton.Builder(if (saved) CommandButton.ICON_BOOKMARK_FILLED else CommandButton.ICON_BOOKMARK)
      .setDisplayName(if (saved) "Sangen er gemt" else "Gem sang")
      .setSessionCommand(SessionCommand(CMD_SAVE_SONG, Bundle.EMPTY))
      .setEnabled(!saved)
      .build()
  }

  /** Knapperne i bilen og notifikationen: hjertet, og bogmaerket naar der er en sang. */
  fun buttons(): ImmutableList<CommandButton> {
    val list = ImmutableList.builder<CommandButton>()
    list.add(favouriteButton())
    saveSongButton()?.let { list.add(it) }
    return list.build()
  }

  fun refreshButtons() {
    session?.setMediaButtonPreferences(buttons())
  }

  /** Gemmer sangen der spiller; falsk naar streamen ikke har sagt nogen. */
  fun saveCurrentSong(): Boolean {
    val song = currentSong ?: return false
    SavedSongs.add(this, song, currentStation()?.name ?: base?.title?.toString() ?: "")
    refreshButtons()
    return true
  }

  private val buttonListener =
    object : Player.Listener {
      override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) = refreshButtons()
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
    built.addListener(buttonListener)
    reconnect = Reconnect(this, built, main).also { it.start() }
    player = built
    session =
      MediaLibrarySession.Builder(this, built, Callback(this))
        .setMediaButtonPreferences(buttons())
        .build()
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
    /** Seneste soegning per tekst, saa onGetSearchResult kan svare uden at soege igen. */
    private val searches = HashMap<String, List<Station>>()

    override fun onConnect(session: MediaSession, controller: MediaSession.ControllerInfo): MediaSession.ConnectionResult {
      val commands =
        MediaSession.ConnectionResult.DEFAULT_SESSION_AND_LIBRARY_COMMANDS.buildUpon()
          .add(SessionCommand(CMD_FAVOURITE, Bundle.EMPTY))
          .add(SessionCommand(CMD_SAVE_SONG, Bundle.EMPTY))
          .build()
      return MediaSession.ConnectionResult.AcceptedResultBuilder(session)
        .setAvailableSessionCommands(commands)
        .setMediaButtonPreferences(service.buttons())
        .build()
    }

    override fun onCustomCommand(
      session: MediaSession,
      controller: MediaSession.ControllerInfo,
      customCommand: SessionCommand,
      args: Bundle,
    ): ListenableFuture<SessionResult> {
      if (customCommand.customAction == CMD_SAVE_SONG) {
        val ok = service.saveCurrentSong()
        return Futures.immediateFuture(SessionResult(if (ok) SessionResult.RESULT_SUCCESS else SessionResult.RESULT_ERROR_INVALID_STATE))
      }
      if (customCommand.customAction != CMD_FAVOURITE) return Futures.immediateFuture(SessionResult(SessionResult.RESULT_ERROR_NOT_SUPPORTED))
      val station = service.currentStation() ?: return Futures.immediateFuture(SessionResult(SessionResult.RESULT_ERROR_INVALID_STATE))
      Favourites.toggle(service, station)
      service.refreshButtons()
      // Mine stationer i bilen har aendret sig.
      (session as? MediaLibrarySession)?.notifyChildrenChanged(Library.FAVOURITES, Int.MAX_VALUE, null)
      return Futures.immediateFuture(SessionResult(SessionResult.RESULT_SUCCESS))
    }

    override fun onSearch(
      session: MediaLibrarySession,
      browser: MediaSession.ControllerInfo,
      query: String,
      params: LibraryParams?,
    ): ListenableFuture<LibraryResult<Void>> {
      AutoLog.add("search \"$query\" fra ${browser.packageName}")
      service.fetcher.execute {
        val found = RadioBrowser.search(service, query)
        synchronized(searches) { searches[query] = found }
        for (station in found.take(20)) Artwork.prefetch(service, station.logoUrls)
        session.notifySearchResultChanged(browser, query, found.size, params)
      }
      return Futures.immediateFuture(LibraryResult.ofVoid(params))
    }

    override fun onGetSearchResult(
      session: MediaLibrarySession,
      browser: MediaSession.ControllerInfo,
      query: String,
      page: Int,
      pageSize: Int,
      params: LibraryParams?,
    ): ListenableFuture<LibraryResult<ImmutableList<MediaItem>>> {
      val known = synchronized(searches) { searches[query] }
      if (known != null) {
        return Futures.immediateFuture(LibraryResult.ofItemList(pageOf(known.map { Library.item(it, service) }, page, pageSize), params))
      }
      return Futures.submit(
        Callable<LibraryResult<ImmutableList<MediaItem>>> {
          val found = RadioBrowser.search(service, query)
          synchronized(searches) { searches[query] = found }
          LibraryResult.ofItemList(pageOf(found.map { Library.item(it, service) }, page, pageSize), params)
        },
        service.fetcher,
      )
    }

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
          // Alle logoer i baggrunden, fra toppen og ned, saa rulningen ikke venter paa nettet.
          for (station in onPhone) Artwork.prefetch(service, station.logoUrls)
        } else {
          // Landet er ikke hentet paa telefonen: tjenesten henter det selv,
          // i baggrunden, og bilen faar listen naar den er der.
          return Futures.submit(
            Callable<LibraryResult<ImmutableList<MediaItem>>> {
              val fetched = RadioBrowser.stations(service, code)
              AutoLog.add("hentede $code selv: ${fetched.size} stationer")
              for (station in fetched) Artwork.prefetch(service, station.logoUrls)
              LibraryResult.ofItemList(pageOf(fetched.map { Library.item(it, service) }, page, pageSize), params)
            },
            service.fetcher,
          )
        }
      }
      if (parentId == Library.FAVOURITES) for (station in library.favourites) Artwork.prefetch(service, station.logoUrls)
      val children = library.children(parentId, service)
      val slice = pageOf(children, page, pageSize)
      AutoLog.add("svarer $parentId: ${slice.size} af ${children.size} elementer")
      return Futures.immediateFuture(LibraryResult.ofItemList(slice, params))
    }

    /**
     * Kun den side bilen bad om.
     *
     * Beder bilen om listen i sider og faar hele listen hver gang, staar
     * elementerne dobbelt, og bilen tegner mappen forfra — fra toppen.
     * Uden sider (pageSize er uendelig) er det hele listen.
     */
    private fun pageOf(items: List<MediaItem>, page: Int, pageSize: Int): ImmutableList<MediaItem> {
      if (pageSize <= 0 || pageSize == Int.MAX_VALUE || page < 0) return ImmutableList.copyOf(items)
      val from = page.toLong() * pageSize
      if (from >= items.size) return ImmutableList.of()
      val to = minOf(items.size.toLong(), from + pageSize)
      return ImmutableList.copyOf(items.subList(from.toInt(), to.toInt()))
    }

    override fun onGetItem(
      session: MediaLibrarySession,
      browser: MediaSession.ControllerInfo,
      mediaId: String,
    ): ListenableFuture<LibraryResult<MediaItem>> {
      AutoLog.add("getItem $mediaId")
      val library = Library.read(service)
      // Bilen beder ogsaa om mapperne selv, isaer naar den vender tilbage
      // til en mappe efter afspilning. Fik den en fejl paa det, byggede
      // den mappen forfra og landede i toppen.
      library.folderItem(mediaId)?.let { return Futures.immediateFuture(LibraryResult.ofItem(it, null)) }
      val station = library.find(mediaId) ?: RadioBrowser.find(mediaId.removePrefix(Library.STATION_PREFIX))
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
      // "Afspil Skala FM paa NorRadio" med stemmen: et element uden id, kun en soegetekst.
      val spoken = mediaItems.firstOrNull { it.mediaId.isEmpty() && !it.requestMetadata.searchQuery.isNullOrBlank() }
      if (spoken != null) {
        val query = spoken.requestMetadata.searchQuery ?: ""
        return Futures.submit(
          Callable<MutableList<MediaItem>> {
            val found = RadioBrowser.search(service, query).firstOrNull()
            AutoLog.add("afspil fra soegning \"$query\": ${found?.name ?: "intet"}")
            if (found == null) mutableListOf() else mutableListOf(Library.item(found, service))
          },
          service.fetcher,
        )
      }
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

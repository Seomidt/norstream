package dk.seomidt.norradio.auto

import android.content.Context
import android.net.Uri
import android.os.Bundle
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * Det bilen kan bladre i: favoritterne og de lande hvis stationer ligger
 * paa telefonen. Skrives af appen som JSON (radio-auto-library.json) og
 * laeses her, uden JavaScript: Android Auto starter tjenesten selv, ogsaa
 * naar appen ikke er aaben, og saa skal listen ligge klar paa disken.
 */
data class Station(val id: String, val name: String, val url: String, val logoUrl: String?, val country: String)

data class Country(val code: String, val name: String, val flag: String, val stations: List<Station>)

class Library(val favourites: List<Station>, val countries: List<Country>) {
  companion object {
    private const val FILE = "radio-auto-library.json"
    const val ROOT = "root"
    const val FAVOURITES = "favourites"
    const val COUNTRIES = "countries"
    const val COUNTRY_PREFIX = "country:"
    const val STATION_PREFIX = "station:"

    fun file(context: Context): File = File(context.filesDir, FILE)

    fun write(context: Context, json: String) {
      file(context).writeText(json)
    }

    /** Hvor mange stationer et land faar med i bilen; listen er sorteret efter stemmer, saa toppen er den gode del. */
    const val MAX_IN_CAR = 100

    private var cached: Library? = null
    private var cachedStamp = 0L

    /** Filen laeses og parses kun naar den har aendret sig, ikke for hver mappe bilen aabner. */
    @Synchronized
    fun read(context: Context): Library {
      val f = file(context)
      if (!f.exists()) return Library(emptyList(), emptyList())
      val stamp = f.lastModified() xor f.length()
      cached?.let { if (stamp == cachedStamp) return it }
      val parsed =
        try {
          parse(JSONObject(f.readText()))
        } catch (_: Exception) {
          Library(emptyList(), emptyList())
        }
      cached = parsed
      cachedStamp = stamp
      return parsed
    }

    fun parse(root: JSONObject): Library {
      val favourites = stations(root.optJSONArray("favourites"))
      val countries = ArrayList<Country>()
      val rawCountries = root.optJSONArray("countries") ?: JSONArray()
      for (i in 0 until rawCountries.length()) {
        val c = rawCountries.getJSONObject(i)
        countries.add(
          Country(
            c.optString("code"),
            c.optString("name"),
            c.optString("flag"),
            stations(c.optJSONArray("stations")),
          ),
        )
      }
      return Library(favourites, countries)
    }

    fun station(obj: JSONObject): Station? {
      val id = obj.optString("id")
      val url = obj.optString("url")
      if (id.isEmpty() || url.isEmpty()) return null
      val logo = obj.optString("logoUrl")
      return Station(id, obj.optString("name", id), url, if (logo.isEmpty()) null else logo, obj.optString("country"))
    }

    private fun stations(array: JSONArray?): List<Station> {
      val out = ArrayList<Station>()
      if (array == null) return out
      for (i in 0 until array.length()) station(array.getJSONObject(i))?.let { out.add(it) }
      return out
    }

    private const val EXTRA_NAME = "name"
    private const val EXTRA_LOGO = "logoUrl"
    private const val EXTRA_COUNTRY = "country"

    /** Stationen bag et element der kom over broen uden uri, eller null hvis heller ikke requestMetadata har den. */
    fun fromRequest(item: MediaItem): Station? {
      val uri = item.requestMetadata.mediaUri ?: return null
      val extras = item.requestMetadata.extras
      val id = item.mediaId.removePrefix(STATION_PREFIX)
      if (id.isEmpty()) return null
      val name = item.mediaMetadata.title?.toString() ?: extras?.getString(EXTRA_NAME) ?: id
      // artworkUri peger paa vores egen provider; den rigtige adresse ligger i extras.
      val logo = extras?.getString(EXTRA_LOGO)
      val country = item.mediaMetadata.artist?.toString() ?: extras?.getString(EXTRA_COUNTRY) ?: ""
      return Station(id, name, uri.toString(), logo, country)
    }

    fun folder(id: String, title: String, subtitle: String? = null): MediaItem =
      MediaItem.Builder()
        .setMediaId(id)
        .setMediaMetadata(
          MediaMetadata.Builder()
            .setTitle(title)
            .setSubtitle(subtitle)
            .setIsBrowsable(true)
            .setIsPlayable(false)
            .setMediaType(MediaMetadata.MEDIA_TYPE_FOLDER_RADIO_STATIONS)
            .build(),
        )
        .build()

    /**
     * Et element med adressen baade som uri og i requestMetadata: media3
     * sender ikke uri'en fra appens controller til tjenesten (af
     * sikkerhedsgrunde), men requestMetadata kommer med, saa tjenesten kan
     * finde adressen igen i fromRequest, ogsaa for stationer der ikke staar
     * i biblioteket (fx fra en soegning).
     */
    fun item(station: Station, context: Context): MediaItem =
      MediaItem.Builder()
        .setMediaId(STATION_PREFIX + station.id)
        .setUri(station.url)
        .setRequestMetadata(
          MediaItem.RequestMetadata.Builder()
            .setMediaUri(Uri.parse(station.url))
            .setExtras(
              Bundle().apply {
                putString(EXTRA_NAME, station.name)
                putString(EXTRA_LOGO, station.logoUrl)
                putString(EXTRA_COUNTRY, station.country)
              },
            )
            .build(),
        )
        .setMediaMetadata(
          MediaMetadata.Builder()
            .setTitle(station.name)
            .setArtist(station.country)
            .setStation(station.name)
            .setArtworkUri(station.logoUrl?.let { Artwork.uri(context, it) })
            .setIsBrowsable(false)
            .setIsPlayable(true)
            .setMediaType(MediaMetadata.MEDIA_TYPE_RADIO_STATION)
            .build(),
        )
        .build()
  }

  fun allStations(): List<Station> = favourites + countries.flatMap { it.stations }

  fun find(mediaId: String): Station? {
    val id = mediaId.removePrefix(STATION_PREFIX)
    return allStations().firstOrNull { it.id == id }
  }

  fun children(parentId: String, context: Context): List<MediaItem> =
    when {
      parentId == ROOT ->
        listOf(
          folder(FAVOURITES, "Mine stationer", "${favourites.size}"),
          folder(COUNTRIES, "Lande", "${countries.size}"),
        )
      parentId == FAVOURITES -> favourites.map { item(it, context) }
      parentId == COUNTRIES ->
        countries.map { folder(COUNTRY_PREFIX + it.code, "${it.flag} ${it.name}", "${minOf(it.stations.size, MAX_IN_CAR)}") }
      parentId.startsWith(COUNTRY_PREFIX) -> {
        val code = parentId.removePrefix(COUNTRY_PREFIX)
        countries.firstOrNull { it.code == code }?.stations?.take(MAX_IN_CAR)?.map { item(it, context) } ?: emptyList()
      }
      else -> emptyList()
    }
}

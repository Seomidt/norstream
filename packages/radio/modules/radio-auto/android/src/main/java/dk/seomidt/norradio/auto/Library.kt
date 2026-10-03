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
/** En anden udgave af samme station: samme navn, anden bitrate. */
data class Variant(val bitrate: Int, val url: String)

/** logoUrls: adresser at proeve i raekkefoelge; registrets favicon foerst, saa hjemmesidens ikon. variants: de andre udgaver, til mobilnet. */
data class Station(
  val id: String,
  val name: String,
  val url: String,
  val logoUrls: List<String>,
  val country: String,
  val variants: List<Variant> = emptyList(),
)

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

    /** Skrives til en midlertidig fil og flyttes paa plads: en laeser ser aldrig en halv fil. */
    fun write(context: Context, json: String) {
      val target = file(context)
      val temp = File(target.parentFile, "$FILE.tmp")
      temp.writeText(json)
      if (!temp.renameTo(target)) target.writeText(json)
      AutoLog.add("bibliotek skrevet (${json.length} tegn)")
    }

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
          // En halv eller oedelagt fil: det sidste gode bibliotek er bedre end et tomt.
          AutoLog.add("bibliotek kunne ikke laeses; beholder det gamle")
          cached ?: Library(emptyList(), emptyList())
        }
      cached = parsed
      cachedStamp = stamp
      AutoLog.add("bibliotek laest: ${parsed.favourites.size} favoritter, ${parsed.countries.size} lande")
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
      val logos = ArrayList<String>()
      val list = obj.optJSONArray("logoUrls")
      if (list != null) for (i in 0 until list.length()) list.optString(i).takeIf { it.isNotEmpty() }?.let { logos.add(it) }
      val single = obj.optString("logoUrl")
      if (logos.isEmpty() && single.isNotEmpty()) logos.add(single)
      // Biblioteksfilen kan vaere skrevet foer navnene blev renset.
      return Station(id, RadioBrowser.displayName(obj.optString("name", id)), url, logos, obj.optString("country"))
    }

    /**
     * Stationerne i filen, renset som appen ville have gjort det: kendte
     * doede streams vaek og én udgave per navn. Filen kan vaere skrevet
     * af en aeldre app, og bilen starter tjenesten uden at appen har
     * vaeret aaben og skrevet den igen.
     */
    private fun stations(array: JSONArray?): List<Station> {
      val out = ArrayList<Station>()
      if (array == null) return out
      for (i in 0 until array.length()) {
        val station = station(array.getJSONObject(i)) ?: continue
        if (RadioBrowser.isKnownDeadUrl(station.url)) continue
        out.add(station)
      }
      // Filens raekkefoelge er appens: de mest populaere foerst.
      return RadioBrowser.preferBestQuality(out) { RadioBrowser.streamScore(it.url, 0) }
    }

    private const val EXTRA_NAME = "name"
    private const val EXTRA_LOGO = "logoUrl"
    private const val EXTRA_COUNTRY = "country"
    const val LOGO_SEPARATOR = "\n"
    /** I MediaMetadata.extras: det der spilles lige nu, sat af tjenesten. */
    const val META_STATION = "station"
    const val META_ARTIST = "artist"
    const val META_TRACK = "track"
    const val META_COVER = "coverUrl"
    const val META_LOGOS = "logoUrls"

    /** Stationen bag et element der kom over broen uden uri, eller null hvis heller ikke requestMetadata har den. */
    fun fromRequest(item: MediaItem): Station? {
      val uri = item.requestMetadata.mediaUri ?: return null
      val extras = item.requestMetadata.extras
      val id = item.mediaId.removePrefix(STATION_PREFIX)
      if (id.isEmpty()) return null
      val name = item.mediaMetadata.title?.toString() ?: extras?.getString(EXTRA_NAME) ?: id
      // artworkUri peger paa vores egen provider; den rigtige adresse ligger i extras.
      val logos = extras?.getString(EXTRA_LOGO)?.split(LOGO_SEPARATOR)?.filter { it.isNotEmpty() } ?: emptyList()
      val country = item.mediaMetadata.artist?.toString() ?: extras?.getString(EXTRA_COUNTRY) ?: ""
      return Station(id, name, uri.toString(), logos, country)
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
                putString(EXTRA_LOGO, station.logoUrls.joinToString(LOGO_SEPARATOR))
                putString(EXTRA_COUNTRY, station.country)
              },
            )
            .build(),
        )
        .setMediaMetadata(
          MediaMetadata.Builder()
            .setTitle(station.name)
            // Undertitlen i bilens liste: landet, og ♪ naar stationen er kendt for at sende titel.
            .setArtist(if (station.id in AutoLog.titledStations(context)) "${station.country} · ♪ sang og cover" else station.country)
            .setStation(station.name)
            .setExtras(Bundle().apply { putString(META_LOGOS, station.logoUrls.joinToString(LOGO_SEPARATOR)) })
            .setArtworkUri(if (station.logoUrls.isEmpty()) null else Artwork.uri(context, station.logoUrls))
            .setIsBrowsable(false)
            .setIsPlayable(true)
            .setMediaType(MediaMetadata.MEDIA_TYPE_RADIO_STATION)
            .build(),
        )
        .build()
  }

  fun allStations(): List<Station> = favourites + countries.flatMap { it.stations }

  /** Mappen med det id, som bilen ser den i listerne; null naar id'et ikke er en mappe. */
  fun folderItem(mediaId: String): MediaItem? =
    when {
      mediaId == ROOT -> folder(ROOT, "NorRadio")
      mediaId == FAVOURITES -> folder(FAVOURITES, "Mine stationer", "${favourites.size}")
      mediaId == COUNTRIES -> folder(COUNTRIES, "Lande", "${countries.size}")
      mediaId.startsWith(COUNTRY_PREFIX) -> {
        val code = mediaId.removePrefix(COUNTRY_PREFIX)
        val country = countries.firstOrNull { it.code == code } ?: return folder(mediaId, code)
        folder(mediaId, "${country.flag} ${country.name}", if (country.stations.isEmpty()) null else "${country.stations.size}")
      }
      else -> null
    }

  /** Landets stationer i filen, eller tom naar landet ikke er hentet paa telefonen. */
  fun stationsOf(code: String): List<Station> = countries.firstOrNull { it.code == code }?.stations ?: emptyList()

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
        // Lande uden stationer i filen henter tjenesten selv naar bilen aabner dem; de faar intet tal.
        countries.map { folder(COUNTRY_PREFIX + it.code, "${it.flag} ${it.name}", if (it.stations.isEmpty()) null else "${it.stations.size}") }
      parentId.startsWith(COUNTRY_PREFIX) -> {
        val code = parentId.removePrefix(COUNTRY_PREFIX)
        countries.firstOrNull { it.code == code }?.stations?.map { item(it, context) } ?: emptyList()
      }
      else -> emptyList()
    }
}

package dk.seomidt.norradio.auto

import android.content.Context
import android.net.Uri
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.ConcurrentHashMap

/**
 * Stationerne i et land, hentet af tjenesten selv.
 *
 * Bilen aabner lande telefonen aldrig har hentet, og biblioteket paa disken
 * har dem uden stationer. Saa spoerger tjenesten Radio Browser direkte —
 * samme adresse, samme sortering og samme graense som appen — og husker
 * svaret paa disken en uge, saa naeste tur ikke koster en hentning.
 *
 * Alle stationer der er sendt til bilen huskes efter id: naar bilen vaelger
 * en, kommer der kun et id tilbage, og adressen skal slaas op igen.
 */
object RadioBrowser {
  private const val API = "https://de1.api.radio-browser.info/json"
  private const val LIMIT = 300
  private const val TTL_MS = 7L * 24 * 60 * 60 * 1000
  private const val USER_AGENT = "NorRadio/1.0 (Android; +https://github.com/Seomidt/norstream)"

  private val known = ConcurrentHashMap<String, Station>()
  private val memory = ConcurrentHashMap<String, List<Station>>()

  /** En station bilen har faaet vist, uanset om den kom fra filen eller fra en hentning. */
  fun remember(stations: List<Station>) {
    for (station in stations) known[station.id] = station
  }

  fun find(id: String): Station? = known[id]

  /** Landets stationer, fra hukommelse, disk eller nettet; tom liste naar intet kan naas. */
  fun stations(context: Context, code: String): List<Station> {
    memory[code]?.let { return it }
    val file = File(context.cacheDir, "rb-${code.lowercase()}.json")
    val cached =
      if (file.exists() && System.currentTimeMillis() - file.lastModified() < TTL_MS) {
        try {
          parse(JSONArray(file.readText()), code)
        } catch (_: Exception) {
          null
        }
      } else null
    val stations =
      cached
        ?: fetch(code)?.let { body ->
          try {
            val parsed = parse(JSONArray(body), code)
            file.writeText(body)
            parsed
          } catch (_: Exception) {
            null
          }
        }
        ?: emptyList()
    if (stations.isNotEmpty()) {
      memory[code] = stations
      remember(stations)
    }
    return stations
  }

  private fun fetch(code: String): String? =
    try {
      val url = "$API/stations/bycountrycodeexact/${Uri.encode(code.uppercase())}?order=votes&reverse=true&hidebroken=true&limit=$LIMIT"
      val connection = URL(url).openConnection() as HttpURLConnection
      connection.connectTimeout = 10000
      connection.readTimeout = 15000
      connection.setRequestProperty("User-Agent", USER_AGENT)
      connection.setRequestProperty("Accept", "application/json")
      try {
        if (connection.responseCode !in 200..299) null else connection.inputStream.bufferedReader().use { it.readText() }
      } finally {
        connection.disconnect()
      }
    } catch (_: Exception) {
      null
    }

  /** Samme regler som appens toRadioStation og radioLogoUrls. */
  fun parse(array: JSONArray, code: String): List<Station> {
    val out = ArrayList<Station>()
    val seen = HashSet<String>()
    for (i in 0 until array.length()) {
      val raw = array.optJSONObject(i) ?: continue
      val id = raw.optString("stationuuid")
      val name = raw.optString("name").replace(Regex("\\s+"), " ").trim()
      val resolved = raw.optString("url_resolved")
      val url = if (resolved.isNotEmpty()) resolved else raw.optString("url")
      if (id.isEmpty() || name.isEmpty() || !isHttp(url) || !seen.add(id)) continue
      val logos = ArrayList<String>()
      val favicon = raw.optString("favicon")
      if (isHttp(favicon)) logos.add(favicon)
      homepageIcon(raw.optString("homepage"))?.let { if (!logos.contains(it)) logos.add(it) }
      out.add(Station(id, name, url, logos, raw.optString("countrycode", code).uppercase()))
    }
    return out
  }

  private fun isHttp(value: String): Boolean = value.startsWith("http://", ignoreCase = true) || value.startsWith("https://", ignoreCase = true)

  /** Hjemmesidens ikon fra Googles ikontjeneste, som i appen. */
  fun homepageIcon(homepage: String): String? {
    if (!isHttp(homepage)) return null
    val host =
      try {
        Uri.parse(homepage).host?.removePrefix("www.")?.lowercase() ?: return null
      } catch (_: Exception) {
        return null
      }
    if (host.isEmpty() || !host.contains('.')) return null
    return "https://www.google.com/s2/favicons?domain=${Uri.encode(host)}&sz=128"
  }
}

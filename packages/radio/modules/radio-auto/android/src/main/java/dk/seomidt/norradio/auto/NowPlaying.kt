package dk.seomidt.norradio.auto

import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import org.json.JSONObject

/**
 * Det der spilles lige nu, laest ud af streamen.
 *
 * Icecast sender en tekstlinje ("StreamTitle") med i lyden, typisk
 * "Kunstner - Titel". Maalt paa de 14 mest stemte danske stationer sendte
 * 9 en saadan linje; resten sendte tomt, en programbeskrivelse (DR P1, P4)
 * eller en reklame. Kun linjer paa formen "kunstner - titel" tages for
 * gode varer; alt andet lader stationens eget navn staa.
 */
data class NowPlaying(val artist: String, val track: String) {
  companion object {
    private val SHAPE = Regex("^\\s*/?\\s*(.{1,80}?)\\s+[-–]\\s+(.{1,120}?)\\s*$")
    private val NOISE = Regex("(https?://|www\\.|\\.com\\b|\\.dk\\b|\\.de\\b|\\.net\\b|shopify|advert|reklame|commercial)", RegexOption.IGNORE_CASE)

    /** Null naar linjen ikke er en sang: tom, for lang, en beskrivelse, en reklame, eller stationens navn. */
    fun parse(raw: String, stationName: String): NowPlaying? {
      val text = raw.trim()
      if (text.isEmpty() || text.length > 200) return null
      if (NOISE.containsMatchIn(text)) return null
      if (text.split(Regex("\\s+")).size > 16) return null
      val match = SHAPE.find(text) ?: return null
      val artist = match.groupValues[1].trim()
      val track = match.groupValues[2].trim()
      if (artist.isEmpty() || track.isEmpty()) return null
      if (artist.equals(track, ignoreCase = true)) return null
      if (artist.equals(stationName, ignoreCase = true) || track.equals(stationName, ignoreCase = true)) return null
      return NowPlaying(artist, track)
    }
  }
}

/**
 * Coveret til en sang, slaaet op paa iTunes' aabne soegning.
 *
 * Maalt paa seks rigtige sange fra danske stationer fandt den cover for
 * fem. Svar huskes per sang, ogsaa "intet fundet", saa den samme sang ikke
 * koster to opslag. Billedet leveres i 600 px; Artwork skalerer det ned.
 */
object Covers {
  private const val USER_AGENT = "NorRadio/1.0 (Android; +https://github.com/Seomidt/norstream)"
  private const val MAX = 200
  private val cache = object : LinkedHashMap<String, String?>(64, 0.75f, true) {
    override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, String?>?): Boolean = size > MAX
  }

  fun lookup(playing: NowPlaying): String? {
    val key = "${playing.artist.lowercase()}|${playing.track.lowercase()}"
    synchronized(cache) { if (cache.containsKey(key)) return cache[key] }
    val found = fetch(playing)
    synchronized(cache) { cache[key] = found }
    return found
  }

  private fun fetch(playing: NowPlaying): String? =
    try {
      val term = URLEncoder.encode("${playing.artist} ${cleanTrack(playing.track)}", "UTF-8")
      val connection = URL("https://itunes.apple.com/search?term=$term&entity=song&limit=3&country=dk").openConnection() as HttpURLConnection
      connection.connectTimeout = 5000
      connection.readTimeout = 6000
      connection.setRequestProperty("User-Agent", USER_AGENT)
      val body =
        try {
          if (connection.responseCode !in 200..299) null else connection.inputStream.bufferedReader().use { it.readText() }
        } finally {
          connection.disconnect()
        }
      body?.let { parse(it) }
    } catch (_: Exception) {
      null
    }

  /** "(Felix Cartal Remix)" og "[Radio Edit]" forstyrrer soegningen mere end de hjaelper. */
  private fun cleanTrack(track: String): String = track.replace(Regex("\\s*[\\(\\[].*?[\\)\\]]"), "").trim().ifEmpty { track }

  fun parse(body: String): String? {
    val results = JSONObject(body).optJSONArray("results") ?: return null
    for (i in 0 until results.length()) {
      val url = results.optJSONObject(i)?.optString("artworkUrl100").orEmpty()
      if (url.startsWith("http")) return url.replace("100x100", "600x600")
    }
    return null
  }
}

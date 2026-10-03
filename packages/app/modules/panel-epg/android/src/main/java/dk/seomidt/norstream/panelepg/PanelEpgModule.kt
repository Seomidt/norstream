package dk.seomidt.norstream.panelepg

import android.os.Process
import android.util.Xml
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONArray
import org.json.JSONObject
import org.xmlpull.v1.XmlPullParser
import java.io.BufferedInputStream
import java.io.File
import java.io.FileInputStream
import java.io.IOException
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.Calendar
import java.util.TimeZone
import java.util.zip.GZIPInputStream
import kotlin.concurrent.thread

/**
 * Panelets egen programoversigt (xmltv.php), laest som TiviMate goer det.
 *
 * Panelet giver kun EPG gennem `get_short_epg` for de kanaler der har et
 * EPG-id (13 %), og det er mest de danske. Resten — UK, US m.fl. — ligger
 * kun i panelets store XMLTV-fil (~98 MB). Den kan JavaScript ikke baere:
 * hele filen som én streng og parset paa samme traad som trykkene frøs
 * boksen (v314–v317). Her sker alt i en baggrundstraad med lav prioritet,
 * bid for bid, og filen holdes aldrig i hukommelsen:
 *
 *  1. `download` henter filen ned i cachen.
 *  2. `channels` laeser kun kanal-listen (id og navne) og stopper ved
 *     foerste program — kanalerne staar foerst i en XMLTV-fil.
 *  3. JavaScript matcher appens kanaler paa navn og land.
 *  4. `programmes` laeser kun programmerne for de fundne kanaler, i et
 *     tidsvindue, og springer resten over.
 *
 * Fejlbeskeder rummer aldrig adressen (den har panelets kodeord).
 */
class PanelEpgModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("PanelEpg")

    /** Henter filen til cachen; svarer med stien. `headersJson` er et objekt (fx Host ved DNS-omvej). */
    AsyncFunction("download") { url: String, headersJson: String, promise: Promise ->
      background(promise) { download(url, headersJson) }
    }

    /** Kanalerne i filen som JSON: [{"id": "...", "n": ["navn", ...]}]. */
    AsyncFunction("channels") { path: String, promise: Promise ->
      background(promise) { channels(File(path)) }
    }

    /**
     * Programmerne for de kanal-id'er der er bedt om, der overlapper
     * [fromMs, toMs), som JSON: [{"c","s","e","t","d"}].
     */
    AsyncFunction("programmes") { path: String, idsJson: String, fromMs: Double, toMs: Double, promise: Promise ->
      background(promise) { programmes(File(path), idsJson, fromMs.toLong(), toMs.toLong()) }
    }

    Function("remove") { path: String -> File(path).delete() }
  }

  /** Arbejdet i sin egen traad med baggrunds-prioritet: det maa aldrig kunne maerkes paa trykkene. */
  private fun background(promise: Promise, work: () -> Any?) {
    thread(isDaemon = true, name = "panel-epg") {
      try {
        Process.setThreadPriority(Process.THREAD_PRIORITY_BACKGROUND)
      } catch (_: Exception) {
        // Prioriteten er en hjaelp, ikke en forudsaetning.
      }
      try {
        promise.resolve(work())
      } catch (error: Throwable) {
        promise.reject("ERR_PANEL_EPG", describe(error), null)
      }
    }
  }

  private class HttpStatus(val code: Int) : IOException("http $code")

  private class TooLarge : IOException("for stor")

  /** Fejlen i ord uden adresse: klassen, og HTTP-svaret hvis der var et. */
  private fun describe(error: Throwable): String =
    when (error) {
      is HttpStatus -> "Panelet svarede HTTP ${error.code}"
      is TooLarge -> "Programoversigten er for stor"
      else -> error.javaClass.simpleName
    }

  private fun download(url: String, headersJson: String): String {
    val context = appContext.reactContext ?: throw IllegalStateException("Ingen kontekst")
    val target = File(context.cacheDir, "panel-epg.xml")
    val temp = File(context.cacheDir, "panel-epg.xml.part")
    val connection = URL(url).openConnection() as HttpURLConnection
    connection.connectTimeout = 20_000
    connection.readTimeout = 60_000
    connection.instanceFollowRedirects = true
    // Samme som appens egne panel-kald (React Natives fetch), som panelet kender.
    connection.setRequestProperty("User-Agent", "okhttp/4.12.0")
    val headers = JSONObject(headersJson)
    for (key in headers.keys()) connection.setRequestProperty(key, headers.getString(key))
    try {
      val code = connection.responseCode
      if (code != HttpURLConnection.HTTP_OK) throw HttpStatus(code)
      var total = 0L
      connection.inputStream.use { input ->
        temp.outputStream().buffered(BUFFER).use { out ->
          val buffer = ByteArray(BUFFER)
          while (true) {
            val read = input.read(buffer)
            if (read < 0) break
            total += read
            if (total > MAX_BYTES) throw TooLarge()
            out.write(buffer, 0, read)
          }
        }
      }
      if (!temp.renameTo(target)) {
        temp.copyTo(target, overwrite = true)
      }
      return target.absolutePath
    } finally {
      connection.disconnect()
      temp.delete()
    }
  }

  /** Filen, pakket ud hvis den er gzip (panelet kan sende den pakket uden at sige det). */
  private fun open(file: File): InputStream {
    val raw = BufferedInputStream(FileInputStream(file), BUFFER)
    raw.mark(2)
    val first = raw.read()
    val second = raw.read()
    raw.reset()
    return if (first == 0x1f && second == 0x8b) BufferedInputStream(GZIPInputStream(raw, BUFFER), BUFFER) else raw
  }

  private fun parser(input: InputStream): XmlPullParser {
    val parser = Xml.newPullParser()
    parser.setFeature(XmlPullParser.FEATURE_PROCESS_NAMESPACES, false)
    // Tilgivende: en ukendt entitet (&nbsp;) maa ikke stoppe hele filen.
    try {
      parser.setFeature("http://xmlpull.org/v1/doc/features.html#relaxed", true)
    } catch (_: Exception) {
      // Parseren kan ikke; saa stopper den bare ved foerste fejl med det den har.
    }
    parser.setInput(input, null)
    return parser
  }

  /** Teksten i det element parseren staar paa, eller null hvis det ikke er ren tekst. */
  private fun text(parser: XmlPullParser): String? =
    try {
      parser.nextText()?.trim()?.takeIf { it.isNotEmpty() }
    } catch (_: Exception) {
      null
    }

  /** Springer resten af det element over, som parseren staar i starten af. */
  private fun skip(parser: XmlPullParser, depth: Int) {
    while (true) {
      val event = parser.next()
      if (event == XmlPullParser.END_DOCUMENT) return
      if (event == XmlPullParser.END_TAG && parser.depth == depth) return
    }
  }

  private fun channels(file: File): String {
    val out = JSONArray()
    open(file).use { input ->
      val parser = parser(input)
      try {
        var event = parser.eventType
        loop@ while (event != XmlPullParser.END_DOCUMENT) {
          if (event == XmlPullParser.START_TAG) {
            when (parser.name) {
              // Kanalerne staar foerst; ved foerste program er listen hel.
              "programme" -> break@loop
              "channel" -> {
                val id = parser.getAttributeValue(null, "id")
                val depth = parser.depth
                val names = JSONArray()
                while (true) {
                  event = parser.next()
                  if (event == XmlPullParser.END_DOCUMENT) break
                  if (event == XmlPullParser.END_TAG && parser.depth == depth) break
                  if (event == XmlPullParser.START_TAG && parser.name == "display-name") {
                    text(parser)?.let { names.put(it) }
                  }
                }
                if (!id.isNullOrEmpty()) out.put(JSONObject().put("id", id).put("n", names))
              }
            }
          }
          event = parser.next()
        }
      } catch (_: Exception) {
        // En skadet fil: det der naaede at blive laest, er bedre end intet.
      }
    }
    return out.toString()
  }

  private fun programmes(file: File, idsJson: String, fromMs: Long, toMs: Long): String {
    val wanted = HashSet<String>()
    val ids = JSONArray(idsJson)
    for (i in 0 until ids.length()) wanted.add(ids.getString(i))
    val out = JSONArray()
    if (wanted.isEmpty()) return out.toString()
    var count = 0
    open(file).use { input ->
      val parser = parser(input)
      try {
        var event = parser.eventType
        while (event != XmlPullParser.END_DOCUMENT && count < MAX_PROGRAMMES) {
          if (event == XmlPullParser.START_TAG && parser.name == "programme") {
            val channel = parser.getAttributeValue(null, "channel")
            val depth = parser.depth
            if (channel == null || channel !in wanted) {
              skip(parser, depth)
            } else {
              val start = parseTime(parser.getAttributeValue(null, "start"))
              val stop = parseTime(parser.getAttributeValue(null, "stop"))
              var title: String? = null
              var desc: String? = null
              while (true) {
                event = parser.next()
                if (event == XmlPullParser.END_DOCUMENT) break
                if (event == XmlPullParser.END_TAG && parser.depth == depth) break
                if (event == XmlPullParser.START_TAG) {
                  when (parser.name) {
                    "title" -> if (title == null) title = text(parser)
                    "desc" -> if (desc == null) desc = text(parser)
                  }
                }
              }
              if (start != null && stop != null && stop > start && stop > fromMs && start < toMs && title != null) {
                val entry = JSONObject().put("c", channel).put("s", start).put("e", stop).put("t", title)
                desc?.let { entry.put("d", it.take(MAX_DESC)) }
                out.put(entry)
                count++
              }
            }
          }
          event = parser.next()
        }
      } catch (_: Exception) {
        // Som ovenfor: behold det der naaede at blive laest.
      }
    }
    return out.toString()
  }

  private companion object {
    const val BUFFER = 1 shl 16
    /** Et loft saa en fejlkonfigureret server ikke kan fylde boksen. */
    const val MAX_BYTES = 400L * 1024 * 1024
    /** Nok til flere hundrede kanaler i tre doegn. */
    const val MAX_PROGRAMMES = 80_000
    const val MAX_DESC = 400

    /** "20260924060000 +0200". Mangler offset, er det UTC — som core's parseXmltvTimestamp. */
    val TIME = Regex("^(\\d{4})(\\d{2})(\\d{2})(\\d{2})(\\d{2})(\\d{2})?\\s*([+-]\\d{4})?")

    fun parseTime(value: String?): Long? {
      val match = TIME.find(value?.trim() ?: return null) ?: return null
      val g = match.groupValues
      val month = g[2].toInt()
      val day = g[3].toInt()
      val hour = g[4].toInt()
      val minute = g[5].toInt()
      val second = g[6].ifEmpty { "0" }.toInt()
      if (month !in 1..12 || day !in 1..31 || hour > 23 || minute > 59 || second > 59) return null
      val calendar = Calendar.getInstance(TimeZone.getTimeZone("UTC"))
      calendar.clear()
      calendar.set(g[1].toInt(), month - 1, day, hour, minute, second)
      var ms = calendar.timeInMillis
      val offset = g[7]
      if (offset.isNotEmpty()) {
        val sign = if (offset.startsWith("-")) -1 else 1
        val hours = offset.substring(1, 3).toInt()
        val minutes = offset.substring(3, 5).toInt()
        if (hours > 14 || minutes > 59) return null
        ms -= sign * (hours * 60L + minutes) * 60_000L
      }
      return ms
    }
  }
}

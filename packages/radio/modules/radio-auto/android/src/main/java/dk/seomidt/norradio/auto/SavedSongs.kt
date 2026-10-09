package dk.seomidt.norradio.auto

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/**
 * Sange gemt fra bilen.
 *
 * Bogmaerket i Android Autos afspilningsskaerm laegger den sang der spiller
 * til side her. Databasen tilhoerer appen, saa den foerer dem ind naeste
 * gang den er aaben — samme moenster som favoritterne.
 */
object SavedSongs {
  private const val PREFS = "radio-auto"
  private const val KEY_PENDING = "pendingSongs"

  fun add(context: Context, song: NowPlaying, station: String) {
    val pending = pendingArray(context)
    val kept = JSONArray()
    for (i in 0 until pending.length()) {
      val entry = pending.optJSONObject(i) ?: continue
      if (!same(entry, song)) kept.put(entry)
    }
    kept.put(
      JSONObject()
        .put("artist", song.artist)
        .put("track", song.track)
        .put("station", station)
        .put("savedMs", System.currentTimeMillis()),
    )
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY_PENDING, kept.toString()).apply()
    AutoLog.add("sang gemt: ${song.artist} - ${song.track}")
  }

  /** Om sangen allerede ligger og venter paa appen — saa bogmaerket kan vises fyldt. */
  fun isPending(context: Context, song: NowPlaying): Boolean {
    val pending = pendingArray(context)
    for (i in 0 until pending.length()) {
      val entry = pending.optJSONObject(i) ?: continue
      if (same(entry, song)) return true
    }
    return false
  }

  fun pending(context: Context): List<Map<String, Any?>> {
    val array = pendingArray(context)
    val out = ArrayList<Map<String, Any?>>()
    for (i in 0 until array.length()) {
      val entry = array.optJSONObject(i) ?: continue
      out.add(
        mapOf(
          "artist" to entry.optString("artist"),
          "track" to entry.optString("track"),
          "station" to entry.optString("station"),
          "savedMs" to entry.optLong("savedMs", System.currentTimeMillis()).toDouble(),
        ),
      )
    }
    return out
  }

  fun clearPending(context: Context) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove(KEY_PENDING).apply()
  }

  private fun same(entry: JSONObject, song: NowPlaying): Boolean =
    entry.optString("artist").equals(song.artist, ignoreCase = true) && entry.optString("track").equals(song.track, ignoreCase = true)

  private fun pendingArray(context: Context): JSONArray =
    try {
      JSONArray(context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_PENDING, "[]") ?: "[]")
    } catch (_: Exception) {
      JSONArray()
    }
}

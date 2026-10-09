package dk.seomidt.norradio.auto

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/**
 * Favoritter valgt fra bilen.
 *
 * Databasen tilhoerer appen (JavaScript), og tjenesten kan ikke skrive i
 * den. Saa et tryk paa hjertet i bilen skriver stationen ind i
 * bibliotekfilen med det samme (saa Mine stationer i bilen er rigtig med
 * det samme) og laegger et notat til appen, som foerer det ind i
 * databasen naeste gang den er aaben.
 */
object Favourites {
  private const val PREFS = "radio-auto"
  private const val KEY_PENDING = "pendingFavourites"

  fun isFavourite(context: Context, stationId: String): Boolean =
    Library.read(context).favourites.any { it.id == stationId }

  /** Slaar stationen til eller fra som favorit; svarer med den nye tilstand. */
  fun toggle(context: Context, station: Station): Boolean {
    val on = !isFavourite(context, station.id)
    rewriteLibrary(context, station, on)
    val pending = pendingArray(context)
    val kept = JSONArray()
    for (i in 0 until pending.length()) {
      val entry = pending.optJSONObject(i) ?: continue
      if (entry.optString("id") != station.id) kept.put(entry)
    }
    kept.put(toJson(station).put("on", on))
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY_PENDING, kept.toString()).apply()
    AutoLog.add("favorit ${if (on) "til" else "fra"}: ${station.name}")
    return on
  }

  /** Notaterne til appen: hvad bilen har slaaet til og fra siden sidst. */
  fun pending(context: Context): List<Map<String, Any?>> {
    val array = pendingArray(context)
    val out = ArrayList<Map<String, Any?>>()
    for (i in 0 until array.length()) {
      val entry = array.optJSONObject(i) ?: continue
      val logos = ArrayList<String>()
      entry.optJSONArray("logoUrls")?.let { for (j in 0 until it.length()) logos.add(it.optString(j)) }
      out.add(
        mapOf(
          "id" to entry.optString("id"),
          "name" to entry.optString("name"),
          "url" to entry.optString("url"),
          "logoUrls" to logos,
          "country" to entry.optString("country"),
          "on" to entry.optBoolean("on", true),
        ),
      )
    }
    return out
  }

  fun clearPending(context: Context) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove(KEY_PENDING).apply()
  }

  private fun pendingArray(context: Context): JSONArray =
    try {
      JSONArray(context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_PENDING, "[]") ?: "[]")
    } catch (_: Exception) {
      JSONArray()
    }

  private fun toJson(station: Station): JSONObject =
    JSONObject()
      .put("id", station.id)
      .put("name", station.name)
      .put("url", station.url)
      .put("logoUrls", JSONArray(station.logoUrls))
      .put("country", station.country)

  /** Bibliotekfilen faar favoritten med det samme, saa bilens Mine stationer passer uden at vente paa appen. */
  private fun rewriteLibrary(context: Context, station: Station, on: Boolean) {
    val file = Library.file(context)
    val root =
      try {
        if (file.exists()) JSONObject(file.readText()) else JSONObject()
      } catch (_: Exception) {
        JSONObject()
      }
    val current = root.optJSONArray("favourites") ?: JSONArray()
    val next = JSONArray()
    for (i in 0 until current.length()) {
      val entry = current.optJSONObject(i) ?: continue
      if (entry.optString("id") != station.id) next.put(entry)
    }
    if (on) next.put(toJson(station))
    root.put("favourites", next)
    if (!root.has("countries")) root.put("countries", JSONArray())
    Library.write(context, root.toString())
  }
}

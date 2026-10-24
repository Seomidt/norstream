package dk.seomidt.norstream.watchnext

import android.content.Context
import android.net.Uri
import androidx.tvprovider.media.tv.TvContractCompat
import androidx.tvprovider.media.tv.WatchNextProgram
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONObject

/**
 * NorStream i Google TV's "Fortsaet med at se" (v338).
 *
 * Googles officielle vej: Watch Next-kanalen i Androids TvProvider
 * (androidx.tvprovider). Appen laegger sine egne titler der — en film man er
 * i gang med, eller serien (paa det afsnit man er naaet) — med position,
 * laengde, plakat og et link (`norstream://…`) der aabner appen dér.
 *
 * Alt er stille ved fejl: paa en telefon findes TvProvider ikke, og hvis
 * Google TV ikke vil vise raekken, sker der bare ingenting.
 */
class WatchNextModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw IllegalStateException("Ingen kontekst")

  override fun definition() = ModuleDefinition {
    Name("WatchNext")

    /** Laegger en titel ind eller opdaterer den. JSON: se src/features/vod/watchNext.ts. */
    AsyncFunction("upsert") { json: String ->
      try {
        val o = JSONObject(json)
        val key = o.getString("key")
        val episode = o.optBoolean("episode", false)
        val builder = WatchNextProgram.Builder()
        builder
          .setType(if (episode) TvContractCompat.PreviewProgramColumns.TYPE_TV_EPISODE else TvContractCompat.PreviewProgramColumns.TYPE_MOVIE)
          .setWatchNextType(TvContractCompat.WatchNextPrograms.WATCH_NEXT_TYPE_CONTINUE)
          .setLastEngagementTimeUtcMillis(System.currentTimeMillis())
          .setLastPlaybackPositionMillis(o.optLong("positionMs", 0).coerceIn(0, Int.MAX_VALUE.toLong()).toInt())
          .setDurationMillis(o.optLong("durationMs", 0).coerceIn(0, Int.MAX_VALUE.toLong()).toInt())
          .setTitle(o.getString("title"))
          .setInternalProviderId(key)
          .setIntentUri(Uri.parse(o.getString("uri")))
        val description = o.optString("description", "")
        if (description.isNotEmpty()) builder.setDescription(description)
        val poster = o.optString("posterUrl", "")
        if (poster.startsWith("http")) {
          builder.setPosterArtUri(Uri.parse(poster))
          builder.setPosterArtAspectRatio(TvContractCompat.PreviewProgramColumns.ASPECT_RATIO_2_3)
        }
        if (episode) {
          if (o.has("season")) builder.setSeasonNumber(o.getInt("season"))
          if (o.has("episodeNumber")) builder.setEpisodeNumber(o.getInt("episodeNumber"))
          val episodeTitle = o.optString("episodeTitle", "")
          if (episodeTitle.isNotEmpty()) builder.setEpisodeTitle(episodeTitle)
        }
        val values = builder.build().toContentValues()
        val resolver = context.contentResolver
        val existing = find(key)
        if (existing != null) {
          // Fjernet af brugeren fra raekken (ikke "browsable"): en ny
          // afspilning er ny interesse, saa den laegges ind paa ny.
          if (!existing.second) {
            resolver.delete(TvContractCompat.buildWatchNextProgramUri(existing.first), null, null)
            resolver.insert(TvContractCompat.WatchNextPrograms.CONTENT_URI, values) != null
          } else {
            resolver.update(TvContractCompat.buildWatchNextProgramUri(existing.first), values, null, null) > 0
          }
        } else {
          resolver.insert(TvContractCompat.WatchNextPrograms.CONTENT_URI, values) != null
        }
      } catch (e: Throwable) {
        false
      }
    }

    /** Fjerner en titel (set faerdig). */
    AsyncFunction("remove") { key: String ->
      try {
        val existing = find(key) ?: return@AsyncFunction false
        context.contentResolver.delete(TvContractCompat.buildWatchNextProgramUri(existing.first), null, null) > 0
      } catch (e: Throwable) {
        false
      }
    }
  }

  /** Appens egen raekke for noeglen: (id, browsable), eller null. */
  private fun find(key: String): Pair<Long, Boolean>? {
    val cursor = context.contentResolver.query(
      TvContractCompat.WatchNextPrograms.CONTENT_URI,
      null,
      null,
      null,
      null,
    ) ?: return null
    cursor.use {
      while (it.moveToNext()) {
        val program = WatchNextProgram.fromCursor(it)
        if (program.internalProviderId == key) return Pair(program.id, program.isBrowsable)
      }
    }
    return null
  }
}

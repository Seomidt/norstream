package dk.seomidt.norradio.auto

import android.content.Context
import java.text.SimpleDateFormat
import java.util.ArrayDeque
import java.util.Date
import java.util.Locale

/**
 * Hvad tjenesten har gjort, til fejlsoegning uden en computer i bilen.
 *
 * Bilens skaerm kan ikke laeses herfra, og telefonen har ingen logcat i
 * haanden. Saa noteres de kald bilen laver og de skift tjenesten selv
 * foretager, og appen viser dem paa en skjult side. Kun det seneste
 * par hundrede linjer, kun i hukommelsen.
 */
object AutoLog {
  private const val MAX = 300
  private val lines = ArrayDeque<String>()
  private val clock = SimpleDateFormat("HH:mm:ss.SSS", Locale.ROOT)

  @Synchronized
  fun add(text: String) {
    lines.addLast("${clock.format(Date())} $text")
    while (lines.size > MAX) lines.removeFirst()
  }

  @Synchronized
  fun all(): List<String> = lines.toList()

  @Synchronized
  fun clear() = lines.clear()

  private const val PREFS = "radio-auto"
  private const val KEY_NOW_PLAYING = "nowPlaying"

  /** Om sang og cover skrives ind i det der spiller. Kan slaas fra for at se om det er dét der faar bilens liste til at hoppe. */
  fun nowPlayingEnabled(context: Context): Boolean =
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(KEY_NOW_PLAYING, true)

  fun setNowPlayingEnabled(context: Context, enabled: Boolean) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(KEY_NOW_PLAYING, enabled).apply()
    add("nu-spiller ${if (enabled) "til" else "fra"}")
  }
}

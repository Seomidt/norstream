package dk.seomidt.norradio.auto

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import org.json.JSONArray
import org.json.JSONObject
import java.util.Calendar

/**
 * Vaekkeuret: en station der begynder at spille paa et klokkeslaet, hver dag.
 *
 * Tiden og stationen ligger i SharedPreferences, saa tjenesten kan finde
 * dem uden appen. Selve uret er systemets AlarmManager med setAlarmClock,
 * som vaekker telefonen praecist og viser uret ved siden af systemets eget.
 * Naar det ringer, starter AlarmReceiver tjenesten, og den saetter naeste
 * dag op igen. Efter en genstart saettes det op igen fra BOOT_COMPLETED.
 */
object Alarm {
  private const val PREFS = "radio-auto"
  private const val KEY_ENABLED = "alarmEnabled"
  private const val KEY_HOUR = "alarmHour"
  private const val KEY_MINUTE = "alarmMinute"
  private const val KEY_STATION = "alarmStation"
  private const val REQUEST_RING = 7001
  private const val REQUEST_SHOW = 7002

  const val ACTION_RING = "dk.seomidt.norradio.ALARM_RING"

  fun get(context: Context): Map<String, Any?> {
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val station = stationJson(context)
    return mapOf(
      "enabled" to prefs.getBoolean(KEY_ENABLED, false),
      "hour" to prefs.getInt(KEY_HOUR, 7),
      "minute" to prefs.getInt(KEY_MINUTE, 0),
      "station" to station?.let { toMap(it) },
      "nextMs" to if (prefs.getBoolean(KEY_ENABLED, false) && station != null) nextRing(prefs.getInt(KEY_HOUR, 7), prefs.getInt(KEY_MINUTE, 0)).toDouble() else null,
    )
  }

  /** Gemmer valget og saetter uret (eller tager det af). json: {enabled, hour, minute, station}. */
  fun set(context: Context, json: String) {
    val obj = JSONObject(json)
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
    prefs.putBoolean(KEY_ENABLED, obj.optBoolean("enabled", false))
    prefs.putInt(KEY_HOUR, obj.optInt("hour", 7).coerceIn(0, 23))
    prefs.putInt(KEY_MINUTE, obj.optInt("minute", 0).coerceIn(0, 59))
    val station = obj.optJSONObject("station")
    if (station == null) prefs.remove(KEY_STATION) else prefs.putString(KEY_STATION, station.toString())
    prefs.apply()
    schedule(context)
  }

  /** Stationen der skal spille, som tjenesten kan afspille den. */
  fun station(context: Context): Station? = stationJson(context)?.let { Library.station(it) }

  fun canScheduleExact(context: Context): Boolean {
    if (Build.VERSION.SDK_INT < 31) return true
    val manager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    return manager.canScheduleExactAlarms()
  }

  /** Saetter naeste ringning, eller tager uret af naar det er slaaet fra. */
  fun schedule(context: Context) {
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val manager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    val ring = ringIntent(context)
    if (!prefs.getBoolean(KEY_ENABLED, false) || stationJson(context) == null) {
      manager.cancel(ring)
      AutoLog.add("vaekkeur: slaaet fra")
      return
    }
    val at = nextRing(prefs.getInt(KEY_HOUR, 7), prefs.getInt(KEY_MINUTE, 0))
    try {
      if (canScheduleExact(context)) {
        manager.setAlarmClock(AlarmManager.AlarmClockInfo(at, showIntent(context)), ring)
      } else {
        // Uden lov til praecise alarmer: saa taet paa som systemet vil.
        manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, ring)
      }
      AutoLog.add("vaekkeur: naeste ringning om ${(at - System.currentTimeMillis()) / 60000} min")
    } catch (e: SecurityException) {
      AutoLog.add("vaekkeur: ingen lov til praecise alarmer")
    }
  }

  /** Foerste gang klokken bliver hh:mm — i dag hvis det er fremme, ellers i morgen. */
  fun nextRing(hour: Int, minute: Int, now: Long = System.currentTimeMillis()): Long {
    val cal = Calendar.getInstance()
    cal.timeInMillis = now
    cal.set(Calendar.HOUR_OF_DAY, hour)
    cal.set(Calendar.MINUTE, minute)
    cal.set(Calendar.SECOND, 0)
    cal.set(Calendar.MILLISECOND, 0)
    if (cal.timeInMillis <= now) cal.add(Calendar.DAY_OF_YEAR, 1)
    return cal.timeInMillis
  }

  private fun ringIntent(context: Context): PendingIntent =
    PendingIntent.getBroadcast(
      context,
      REQUEST_RING,
      Intent(context, AlarmReceiver::class.java).setAction(ACTION_RING),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

  /** Det systemets ur-ikon aabner: appen. */
  private fun showIntent(context: Context): PendingIntent {
    val launch = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: Intent()
    return PendingIntent.getActivity(context, REQUEST_SHOW, launch, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
  }

  private fun stationJson(context: Context): JSONObject? =
    try {
      context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_STATION, null)?.let { JSONObject(it) }
    } catch (_: Exception) {
      null
    }

  private fun toMap(obj: JSONObject): Map<String, Any?> {
    val logos = ArrayList<String>()
    obj.optJSONArray("logoUrls")?.let { for (i in 0 until it.length()) logos.add(it.optString(i)) }
    return mapOf(
      "id" to obj.optString("id"),
      "name" to obj.optString("name"),
      "url" to obj.optString("url"),
      "logoUrl" to (logos.firstOrNull() ?: obj.optString("logoUrl").takeIf { it.isNotEmpty() }),
      "logoUrls" to logos,
      "country" to obj.optString("country"),
    )
  }
}

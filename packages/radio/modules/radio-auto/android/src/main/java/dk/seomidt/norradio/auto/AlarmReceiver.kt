package dk.seomidt.norradio.auto

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Vaekkeuret ringer: start tjenesten med stationen. Og efter en genstart
 * af telefonen: saet uret op igen, for systemet glemmer alarmer ved genstart.
 *
 * Tjenesten startes almindeligt, ikke i forgrunden: media3 loefter den
 * selv i forgrunden saa snart der spilles, og en praecis alarm giver
 * appen lov til det i et lille vindue efter ringningen.
 */
class AlarmReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    when (intent.action) {
      Alarm.ACTION_RING -> {
        AutoLog.add("vaekkeur: ringer")
        try {
          context.startService(Intent(context, RadioAutoService::class.java).setAction(Alarm.ACTION_RING))
        } catch (e: Exception) {
          AutoLog.add("vaekkeur: tjenesten kunne ikke startes (${e.javaClass.simpleName})")
        }
        // Samme tid i morgen.
        Alarm.schedule(context)
      }
      Intent.ACTION_BOOT_COMPLETED, Intent.ACTION_MY_PACKAGE_REPLACED, "android.intent.action.QUICKBOOT_POWERON" -> Alarm.schedule(context)
    }
  }
}

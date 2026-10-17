package dk.seomidt.norstream.processdiagnostics

import android.app.ActivityManager
import android.content.Context
import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** Android gemmer afslutninger uden for processen, ogsaa ved native crash.
 * Kun egen hovedproces og tal returneres; aldrig trace, beskrivelse eller URI. */
class ProcessDiagnosticsModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ProcessDiagnostics")

    AsyncFunction("recentExits") {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
        emptyList<Map<String, Any>>()
      } else {
        try {
          val context = appContext.reactContext
          val manager = context?.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager
          if (context == null || manager == null) {
            emptyList<Map<String, Any>>()
          } else {
            val supportsLowMemory = ActivityManager.isLowMemoryKillReportSupported()
            manager.getHistoricalProcessExitReasons(context.packageName, 0, 16)
              .filter { it.processName == context.packageName }
              .take(8)
              .map { exit ->
                mapOf<String, Any>(
                  "timestamp" to exit.timestamp,
                  "reason" to exit.reason,
                  "status" to exit.status,
                  "pssKiB" to exit.pss,
                  "rssKiB" to exit.rss,
                  "lowMemoryReportSupported" to supportsLowMemory
                )
              }
          }
        } catch (_: Exception) {
          // Fejlfinding maa aldrig forhindre appens opstart.
          emptyList<Map<String, Any>>()
        }
      }
    }
  }
}

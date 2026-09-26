package dk.seomidt.norstream.usb

import android.content.Context
import android.os.Environment
import android.os.storage.StorageManager
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * USB-drev paa tv'et, til sikkerhedskopien.
 *
 * Android TV har ingen filvaelger, men appen maa altid skrive i sin egen
 * mappe paa et drev der sidder i (Android/data/<pakke>/files), uden at
 * spoerge om lov. Her findes de drev der kan tages ud og sidder i, med
 * den mappe. Samme pakke paa en ny boks laeser samme mappe.
 */
class UsbStorageModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("UsbStorage")
    Function("volumes") { volumes() }
  }

  private fun volumes(): List<Map<String, Any?>> {
    val context = appContext.reactContext ?: return emptyList()
    val manager = context.getSystemService(Context.STORAGE_SERVICE) as StorageManager
    val out = ArrayList<Map<String, Any?>>()
    for (dir in context.getExternalFilesDirs(null)) {
      if (dir == null) continue
      val volume =
        try {
          manager.getStorageVolume(dir)
        } catch (_: Exception) {
          null
        } ?: continue
      if (!volume.isRemovable || volume.state != Environment.MEDIA_MOUNTED) continue
      dir.mkdirs()
      out.add(mapOf("path" to dir.absolutePath, "name" to volume.getDescription(context), "uuid" to volume.uuid))
    }
    return out
  }
}

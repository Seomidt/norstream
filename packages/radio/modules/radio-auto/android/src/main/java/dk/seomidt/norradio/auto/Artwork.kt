package dk.seomidt.norradio.auto

import android.content.ContentProvider
import android.content.ContentValues
import android.content.Context
import android.database.Cursor
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.ParcelFileDescriptor
import java.io.File
import java.io.FileNotFoundException
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ExecutionException
import java.util.concurrent.Executors
import java.util.concurrent.Future
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException

/**
 * Smaa logoer til bilen.
 *
 * Android Auto henter selv hvert logo, som stationen peger paa, i fuld
 * stoerrelse, mens man ruller; nogle favicons er kaempestore, andre doede,
 * og listen hakker. Her hentes billedet én gang, skaleres ned til 256 px,
 * gemmes paa disken og gives til bilen gennem en ContentProvider, saa den
 * kun laeser en lille fil.
 *
 * Hentningen maa aldrig blokere den traad bilen spoerger paa. Bilen beder om
 * mange logoer paa én gang, hver forespoergsel holder en binder-traad, og
 * med doede adresser og lange timeouts var alle traade optaget — ogsaa dem
 * afspil-kommandoen skulle komme ind ad. Derfor henter en lille pulje i
 * baggrunden, og en forespoergsel venter hoejst kort paa den; kommer
 * logoet senere, ligger det klar naeste gang bilen spoerger.
 */
object Artwork {
  private const val SIZE = 512
  private const val MAX_BYTES = 6L * 1024 * 1024
  private const val MISS_TTL_MS = 24L * 60 * 60 * 1000
  /** Hvor laenge en forespoergsel fra bilen hoejst venter paa en hentning. */
  private const val WAIT_MS = 1500L
  private val pool = Executors.newFixedThreadPool(3)
  private val inFlight = ConcurrentHashMap<String, Future<File?>>()

  fun authority(context: Context): String = "${context.packageName}.art"

  /** content://<pakke>.art/<adresser>, det bilen faar som artworkUri. Flere adresser adskilt af linjeskift proeves i raekkefoelge. */
  fun uri(context: Context, urls: List<String>): Uri =
    Uri.parse("content://${authority(context)}/${Uri.encode(urls.joinToString(Library.LOGO_SEPARATOR))}")

  /**
   * Den lille fil: fra disken, eller efter hoejst WAIT_MS paa en hentning i
   * baggrunden. Null naar den ikke er der endnu, eller ingen af adresserne
   * kan hentes; hentningen fortsaetter uanset.
   */
  fun cached(context: Context, urlList: String): File? {
    val ready = onDisk(context, urlList) ?: return null
    if (ready.file.exists()) return ready.file
    if (ready.missed) return null
    val future = start(context, urlList, ready)
    return try {
      future.get(WAIT_MS, TimeUnit.MILLISECONDS)
    } catch (_: TimeoutException) {
      null
    } catch (_: ExecutionException) {
      null
    } catch (_: InterruptedException) {
      null
    }
  }

  /** Saetter en hentning i gang uden at vente, til logoerne i en liste bilen lige har faaet. */
  fun prefetch(context: Context, urls: List<String>) {
    if (urls.isEmpty()) return
    val urlList = urls.joinToString(Library.LOGO_SEPARATOR)
    val ready = onDisk(context, urlList) ?: return
    if (ready.file.exists() || ready.missed) return
    start(context, urlList, ready)
  }

  private class Slot(val key: String, val file: File, val miss: File, val temp: File, val missed: Boolean)

  private fun onDisk(context: Context, urlList: String): Slot? {
    if (urlList.split(Library.LOGO_SEPARATOR).none { it.isNotEmpty() }) return null
    val dir = File(context.cacheDir, "art").apply { mkdirs() }
    val key = hash(urlList)
    val miss = File(dir, "$key.miss")
    val missed = miss.exists() && System.currentTimeMillis() - miss.lastModified() < MISS_TTL_MS
    return Slot(key, File(dir, "$key.png"), miss, File(dir, "$key.tmp"), missed)
  }

  private fun start(context: Context, urlList: String, slot: Slot): Future<File?> =
    inFlight.getOrPut(slot.key) {
      pool.submit<File?> {
        try {
          if (slot.file.exists()) return@submit slot.file
          val urls = urlList.split(Library.LOGO_SEPARATOR).filter { it.isNotEmpty() }
          val bitmap = urls.firstNotNullOfOrNull { fetch(it) }
          if (bitmap == null) {
            slot.miss.writeBytes(ByteArray(0))
            return@submit null
          }
          FileOutputStream(slot.temp).use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
          bitmap.recycle()
          slot.miss.delete()
          if (slot.temp.renameTo(slot.file)) slot.file else null
        } finally {
          inFlight.remove(slot.key)
        }
      }
    }

  private fun fetch(url: String): Bitmap? =
    try {
      val connection = URL(url).openConnection() as HttpURLConnection
      connection.connectTimeout = 4000
      connection.readTimeout = 5000
      connection.instanceFollowRedirects = true
      connection.setRequestProperty("User-Agent", "NorRadio/1.0 (Android; +https://github.com/Seomidt/norstream)")
      val bytes =
        try {
          if (connection.responseCode !in 200..299) null
          else if (connection.contentLengthLong > MAX_BYTES) null
          else connection.inputStream.use { it.readBytes() }
        } finally {
          connection.disconnect()
        }
      if (bytes == null || bytes.isEmpty() || bytes.size > MAX_BYTES) null else scale(bytes)
    } catch (_: Exception) {
      null
    }

  private fun scale(bytes: ByteArray): Bitmap? {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
    var sample = 1
    while (bounds.outWidth / (sample * 2) >= SIZE && bounds.outHeight / (sample * 2) >= SIZE) sample *= 2
    val options = BitmapFactory.Options().apply { inSampleSize = sample }
    val decoded = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options) ?: return null
    val longest = maxOf(decoded.width, decoded.height)
    if (longest <= SIZE) return decoded
    val ratio = SIZE.toFloat() / longest
    val scaled = Bitmap.createScaledBitmap(decoded, (decoded.width * ratio).toInt().coerceAtLeast(1), (decoded.height * ratio).toInt().coerceAtLeast(1), true)
    if (scaled !== decoded) decoded.recycle()
    return scaled
  }

  private fun hash(text: String): String =
    MessageDigest.getInstance("SHA-1").digest(text.toByteArray()).joinToString("") { "%02x".format(it) }
}

/** Giver bilen (og notifikationen) de smaa logoer som filer. */
class ArtworkProvider : ContentProvider() {
  override fun onCreate(): Boolean = true

  override fun openFile(uri: Uri, mode: String): ParcelFileDescriptor {
    val context = context ?: throw FileNotFoundException("Ingen kontekst")
    val url = uri.lastPathSegment ?: throw FileNotFoundException("Intet logo")
    val file = Artwork.cached(context, url) ?: throw FileNotFoundException("Logoet kunne ikke hentes")
    return ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)
  }

  override fun getType(uri: Uri): String = "image/png"

  override fun query(uri: Uri, projection: Array<String>?, selection: String?, selectionArgs: Array<String>?, sortOrder: String?): Cursor? = null

  override fun insert(uri: Uri, values: ContentValues?): Uri? = null

  override fun delete(uri: Uri, selection: String?, selectionArgs: Array<String>?): Int = 0

  override fun update(uri: Uri, values: ContentValues?, selection: String?, selectionArgs: Array<String>?): Int = 0
}

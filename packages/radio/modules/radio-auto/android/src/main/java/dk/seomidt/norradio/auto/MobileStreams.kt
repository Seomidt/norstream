package dk.seomidt.norradio.auto

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities

/**
 * Lavere bitrate paa mobilnet.
 *
 * 320 kbit falder let ud et par sekunder ad gangen i bilen, mens 128
 * holder. Paa mobilnet vaelges derfor den hoejeste udgave af stationen
 * op til MAX_MOBILE_KBPS, naar der findes en; paa wifi den bedste. De
 * andre udgaver kommer fra registret (samme navn, anden bitrate) og fra
 * en lille tabel over stationer hvis server har flere, som registret
 * ikke kender. Maalt: PartyFM har 320, 256 og 128 paa samme server.
 */
object MobileStreams {
  const val MAX_MOBILE_KBPS = 192

  private class Known(val matches: Regex, val variants: List<Variant>)

  private val KNOWN =
    listOf(
      Known(
        Regex("stream\\.partyfm\\.dk/Party(320|256)", RegexOption.IGNORE_CASE),
        listOf(
          Variant(320, "https://stream.partyfm.dk/Party320/"),
          Variant(256, "https://stream.partyfm.dk/Party256/"),
          Variant(128, "https://stream.partyfm.dk/Party128/"),
        ),
      ),
    )

  fun onMobileData(context: Context): Boolean {
    val manager = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager ?: return false
    val network = manager.activeNetwork ?: return false
    val caps = manager.getNetworkCapabilities(network) ?: return false
    return caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) && !caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)
  }

  /** Adressen der skal spilles lige nu: stationens egen, eller en lavere udgave paa mobilnet. */
  fun pick(context: Context, station: Station): String {
    if (!onMobileData(context)) return station.url
    val variants = (station.variants + KNOWN.filter { it.matches.containsMatchIn(station.url) }.flatMap { it.variants })
      .filter { it.bitrate in 1..MAX_MOBILE_KBPS && !RadioBrowser.isHlsUrl(it.url) }
    val lower = variants.maxByOrNull { it.bitrate } ?: return station.url
    if (lower.url == station.url) return station.url
    AutoLog.add("mobilnet: ${station.name} paa ${lower.bitrate} kbit i stedet")
    return lower.url
  }
}

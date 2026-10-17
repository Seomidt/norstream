package android.net
import java.net.URI
import java.net.URLDecoder
import java.net.URLEncoder
class Uri(private val text: String) {
  private val parsed get() = URI(text)
  val path: String? get() = parsed.path
  val encodedPath: String? get() = parsed.rawPath
  private val params: List<Pair<String, String>> get() = parsed.rawQuery?.split("&")?.map {
    val pair = it.split("=", limit = 2)
    URLDecoder.decode(pair[0], "UTF-8") to URLDecoder.decode(pair.getOrElse(1) { "" }, "UTF-8")
  }.orEmpty()
  val queryParameterNames get() = params.map { it.first }.toSet()
  fun getQueryParameters(key: String) = params.filter { it.first == key }.map { it.second }
  fun buildUpon() = Builder(parsed.scheme + "://" + parsed.rawAuthority, parsed.rawPath, parsed.rawQuery)
  override fun toString() = text
  class Builder(val prefix: String, var path: String, var query: String?) {
    fun clearQuery(): Builder { query = null; return this }
    fun appendQueryParameter(key: String, value: String): Builder {
      val entry = URLEncoder.encode(key, "UTF-8") + "=" + URLEncoder.encode(value, "UTF-8")
      query = query?.let { "$it&$entry" } ?: entry; return this
    }
    fun encodedPath(value: String): Builder { path = value; return this }
    fun build() = Uri(prefix + path + (query?.let { "?$it" } ?: ""))
  }
}

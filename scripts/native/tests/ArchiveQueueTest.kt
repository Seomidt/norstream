package norstream.tests
import android.content.Context
import android.net.Uri
import android.os.Handler
import androidx.media3.common.C
import androidx.media3.common.Player
import androidx.media3.common.Timeline
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.analytics.AnalyticsListener
import androidx.media3.exoplayer.source.LoadEventInfo
import androidx.media3.exoplayer.source.MediaLoadData
import expo.modules.video.player.NorstreamArchiveQueue
import expo.modules.video.records.VideoSource

private val start = java.time.Instant.parse("2026-10-16T18:00:00Z").toEpochMilli()
private fun source(uri: String = "http://192.0.2.1/streaming/timeshift.php?username=u%2Fser&password=p%26ass&stream=7&start=old&duration=17") = VideoSource(
  uri = Uri(uri), headers = mapOf("Host" to "panel.invalid"),
  norstreamArchive = mapOf("token" to 7.0, "startMs" to start.toDouble(), "stopMs" to (start + 35 * 60_000).toDouble(), "offsetMinutes" to 120.0, "clipMs" to 0.0)
)
private class Fixture(val input: VideoSource = source(), var now: Long = start + 60 * 60_000) {
  val player = ExoPlayer()
  val phases = mutableListOf<String>()
  val queue = NorstreamArchiveQueue(Context(), player, { now }, { phase, _, _, _ -> phases.add(phase) })
  init { queue.start(input); duration(1_020_379) }
  fun duration(ms: Long) { player.currentTimeline.entries.clear(); player.currentMediaItemIndex = 0; player.currentTimeline.entries.add(Timeline.Window(input.toMediaItem(Context()), ms)) }
  fun complete(index: Int = player.currentMediaItemIndex) {
    player.upstreamOpen = false
    queue.onLoadCompleted(AnalyticsListener.EventTime(player.currentTimeline, index), LoadEventInfo(), MediaLoadData(C.DATA_TYPE_MEDIA))
    Handler.drain()
  }
}
fun main() {
  var passed = 0
  fun test(name: String, run: () -> Unit) { Handler.pending.clear(); run(); Handler.pending.clear(); passed++; println("OK: $name") }
  test("ingen preload foer upstream har meldt faerdig") {
    val f = Fixture(); f.player.upstreamOpen = true; Handler.drain(); check(f.player.added.isEmpty())
    f.complete(); check(f.player.added.size == 1)
    val next = f.player.added[0].source
    check(next.headers == f.input.headers)
    check(next.uri!!.getQueryParameters("username") == listOf("u/ser"))
    check(next.uri!!.getQueryParameters("password") == listOf("p&ass"))
    check(next.uri!!.getQueryParameters("start") == listOf("2026-10-16:20-17"))
    check(next.uri!!.getQueryParameters("duration") == listOf("18"))
    check(next.norstreamArchive!!["clipMs"] == 379.0)
  }
  test("reel TS-slut og minut-overlap giver et sammenhaengende ur") {
    val f = Fixture(); f.duration(179_340); f.complete()
    val next = f.player.added.single().source
    check(next.norstreamArchive!!["clipMs"] == 59_340.0)
    f.player.currentMediaItemIndex = 1; f.player.currentPosition = 0
    check(f.queue.transition(next.toMediaItem(Context()), Player.MEDIA_ITEM_TRANSITION_REASON_AUTO))
    check(f.queue.positionMs == 179_340L)
    Handler.drain(); check(f.player.currentTimeline.windowCount == 1)
    f.player.currentPosition = 1000; check(f.queue.positionMs == 180_340L)
    check(f.queue.seekPositionMs(181_340) == 2000L)
  }
  test("hoejst en efterfoelger og oprydning foer tredje stykke") {
    val f = Fixture(); f.complete(); val next = f.player.added[0].source
    f.player.currentTimeline.entries[1] = Timeline.Window(next.toMediaItem(Context()), 120_000)
    f.complete(1); check(f.player.added.size == 1)
    f.player.currentMediaItemIndex = 1; f.player.currentPosition = 0
    check(f.queue.transition(next.toMediaItem(Context()), Player.MEDIA_ITEM_TRANSITION_REASON_AUTO))
    Handler.drain(); check(f.player.added.size == 2); check(f.player.currentTimeline.windowCount == 2)
    check(f.queue.positionMs == 1_020_379L)
  }
  test("Tilbage og zap annullerer en allerede planlagt fortsaettelse") {
    val f = Fixture(); f.queue.onLoadCompleted(AnalyticsListener.EventTime(f.player.currentTimeline, 0), LoadEventInfo(), MediaLoadData(1))
    f.queue.cancel(); Handler.drain(); check(f.player.added.isEmpty()); check(!f.queue.enabled)
    f.queue.start(null); Handler.drain(); check(f.player.added.isEmpty())
  }
  test("ukendt varighed udloeser afgraenset tilbagefald") {
    val f = Fixture(); f.duration(C.TIME_UNSET); f.complete()
    check(f.player.added.isEmpty()); check(f.phases.last() == "tilbagefald"); check(Handler.pending.isEmpty())
  }
  test("15 minutters slutmargen opretter ikke mere arkiv") {
    val f = Fixture(); f.duration(35 * 60_000 - 660); f.complete(); check(f.player.added.isEmpty())
  }
  test("path-arkiv bevarer kodede credentials og paneltid") {
    val f = Fixture(source("http://192.0.2.1/timeshift/u%2Fser/p%26ass/17/2026-10-16:20-00/7.ts"))
    f.complete(); check(f.player.added.single().source.uri.toString() == "http://192.0.2.1/timeshift/u%2Fser/p%26ass/18/2026-10-16:20-17/7.ts")
  }
  test("live og HLS faar ikke en arkivkoe") {
    val f = Fixture(source("http://panel.invalid/live/u/p/7.ts")); check(!f.queue.enabled); f.complete(); check(f.player.added.isEmpty())
    f.queue.start(source("http://panel.invalid/timeshift/u/p/17/2026-10-16:20-00/7.m3u8")); check(!f.queue.enabled)
  }
  test("60 overgange bevarer ur og hoejst to kilder") {
    val initial = source()
    val longer = VideoSource(uri = initial.uri, headers = initial.headers, norstreamArchive = initial.norstreamArchive!! + ("stopMs" to (start + 6 * 3600_000).toDouble()))
    val f = Fixture(longer, start + 12 * 3600_000)
    f.complete()
    repeat(60) { index ->
      val next = f.player.added.last().source
      f.player.currentTimeline.entries[1] = Timeline.Window(next.toMediaItem(Context()), 60_000)
      f.complete(1)
      f.player.currentMediaItemIndex = 1
      f.player.currentPosition = 0
      check(f.queue.transition(next.toMediaItem(Context()), Player.MEDIA_ITEM_TRANSITION_REASON_AUTO))
      Handler.drain()
      check(f.player.currentTimeline.windowCount <= 2)
      check(f.queue.positionMs == 1_020_379 + index * 60_000L)
    }
  }
  println("$passed native koetests bestaaet; testdobler daekker styring, ikke Androids dekoder.")
}

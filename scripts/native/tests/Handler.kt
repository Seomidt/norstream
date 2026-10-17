package android.os
class Handler(looper: Any) {
  companion object {
    val pending = mutableListOf<() -> Unit>()
    fun drain() { repeat(100) { if (pending.isEmpty()) return; pending.removeAt(0)() }; error("Uafgraenset timerkoe") }
  }
  fun post(run: () -> Unit) { pending.add(run) }
  fun postDelayed(run: () -> Unit, delay: Long) { pending.add(run) }
  fun removeCallbacksAndMessages(token: Any?) { pending.clear() }
}

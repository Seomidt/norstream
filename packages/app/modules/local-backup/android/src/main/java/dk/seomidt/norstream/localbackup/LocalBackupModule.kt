package dk.seomidt.norstream.localbackup

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.Inet4Address
import java.net.NetworkInterface
import java.net.ServerSocket
import java.net.Socket
import java.nio.charset.StandardCharsets
import kotlin.concurrent.thread

/**
 * Modtag en sikkerhedskopi direkte fra telefonen paa det lokale wi-fi.
 *
 * Tv'et starter en lille HTTP-server (ingen sky, ingen konto). Den viser
 * sin adresse og en kode; telefonen sender filen med en POST og koden i et
 * hoved. Passer koden, gives filen til JavaScript som en haendelse, og
 * skaermen gendanner. Kun paa det lokale net, kun mens siden er aaben.
 */
class LocalBackupModule : Module() {
  private var server: ServerSocket? = null
  private var running = false

  override fun definition() = ModuleDefinition {
    Name("LocalBackup")
    Events("onReceived")

    /** Enhedens IPv4 paa wi-fi, eller null. */
    Function("localIp") { localIp() }

    /** Starter modtageren med en kode; svarer med porten den lytter paa. */
    AsyncFunction("startReceiver") { pin: String ->
      stop()
      val socket = ServerSocket(0)
      server = socket
      running = true
      thread(isDaemon = true) { acceptLoop(socket, pin) }
      socket.localPort
    }

    Function("stopReceiver") { stop() }
    OnDestroy { stop() }
  }

  private fun stop() {
    running = false
    try {
      server?.close()
    } catch (_: Exception) {
      // Allerede lukket.
    }
    server = null
  }

  private fun acceptLoop(socket: ServerSocket, pin: String) {
    while (running && !socket.isClosed) {
      val client =
        try {
          socket.accept()
        } catch (_: Exception) {
          break
        }
      thread(isDaemon = true) { handle(client, pin) }
    }
  }

  /** Enkel HTTP: laes linjer til tom linje, tag Content-Length og X-Norstream-Pin, laes kroppen. */
  private fun handle(client: Socket, pin: String) {
    try {
      client.use {
        val input = BufferedReader(InputStreamReader(it.getInputStream(), StandardCharsets.UTF_8))
        val requestLine = input.readLine() ?: return
        var length = 0
        var givenPin: String? = null
        while (true) {
          val line = input.readLine() ?: break
          if (line.isEmpty()) break
          val lower = line.lowercase()
          if (lower.startsWith("content-length:")) length = line.substringAfter(':').trim().toIntOrNull() ?: 0
          if (lower.startsWith("x-norstream-pin:")) givenPin = line.substringAfter(':').trim()
        }
        val out = it.getOutputStream()
        if (!requestLine.startsWith("POST")) {
          out.write(response(405, "Metode ikke tilladt").toByteArray(StandardCharsets.UTF_8))
          out.flush()
          return
        }
        if (givenPin != pin) {
          out.write(response(403, "Forkert kode").toByteArray(StandardCharsets.UTF_8))
          out.flush()
          return
        }
        val body = CharArray(length)
        var read = 0
        while (read < length) {
          val n = input.read(body, read, length - read)
          if (n < 0) break
          read += n
        }
        val json = String(body, 0, read)
        // Tilbage paa en traad JavaScript kan hoere paa.
        try {
          sendEvent("onReceived", mapOf("json" to json))
        } catch (_: Exception) {
          // JavaScript er vaek; svar alligevel pænt.
        }
        out.write(response(200, "OK").toByteArray(StandardCharsets.UTF_8))
        out.flush()
      }
    } catch (_: Exception) {
      // En enkelt daarlig forbindelse maa ikke vaelte serveren.
    }
  }

  private fun response(code: Int, text: String): String {
    val body = text.toByteArray(StandardCharsets.UTF_8)
    return "HTTP/1.1 $code OK\r\nContent-Length: ${body.size}\r\nContent-Type: text/plain; charset=utf-8\r\nConnection: close\r\n\r\n$text"
  }

  private fun localIp(): String? {
    try {
      for (nif in NetworkInterface.getNetworkInterfaces()) {
        if (!nif.isUp || nif.isLoopback) continue
        for (address in nif.inetAddresses) {
          if (address is Inet4Address && !address.isLoopbackAddress) {
            val ip = address.hostAddress ?: continue
            if (ip.startsWith("192.") || ip.startsWith("10.") || ip.startsWith("172.")) return ip
          }
        }
      }
    } catch (_: Exception) {
      // Ingen adresse at vise.
    }
    return null
  }
}

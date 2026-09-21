package com.pkt.live.streaming.imou

import android.util.Log
import java.io.InputStream
import java.io.OutputStream
import java.net.InetSocketAddress
import java.net.Socket

/**
 * Port của DhRtspClient.swift (imou/dh_rtsp.DhRtspSession).
 * RTSP verbs qua TCP nhưng Transport Dahua: DH/RTP/TCP;interleaved=0-1 (video).
 * Đọc gói interleaved ($ ch len payload); payload DHAV = pkt[12..] (bỏ 12B RTP hdr).
 */
class DhRtspClient(
    private val url: String,
    private val audio: Boolean = false,
    private val connectTimeoutMs: Int = 20000,
    private val readTimeoutMs: Int = 8000,
    private val playRange: String = "npt=0.000-",
) {
    private var sock: Socket? = null
    private var input: InputStream? = null
    private var output: OutputStream? = null
    private var cseq = 1
    private var sessionId: String? = null
    private val rxBuf = ArrayDeque<Byte>()   // dùng ByteArray buffer thủ công cho nhanh
    private var buf = ByteArray(0)
    private var bufLen = 0
    @Volatile private var closed = false

    private fun host(): String = Regex("rtsp://([^:/]+)").find(url)?.groupValues?.get(1) ?: ""
    private fun port(): Int = Regex("rtsp://[^:/]+:(\\d+)").find(url)?.groupValues?.get(1)?.toIntOrNull() ?: 554

    fun open() {
        val s = Socket()
        s.tcpNoDelay = true
        s.receiveBufferSize = 32 * 1024   // throttle như iOS (relay steady-state)
        s.connect(InetSocketAddress(host(), port()), connectTimeoutMs)
        s.soTimeout = readTimeoutMs
        sock = s; input = s.getInputStream(); output = s.getOutputStream()
        Log.d(TAG, "OPEN $url")

        sendRtsp("OPTIONS", url, emptyMap())
        Log.d(TAG, "OPTIONS -> ${readResponse().status}")
        sendRtsp("DESCRIBE", url, mapOf("Accept" to "application/sdp"))
        val desc = readResponse(); Log.d(TAG, "DESCRIBE -> ${desc.status} body=${desc.body.size}")
        sendRtsp("SETUP", "$url/trackID=0", mapOf("Transport" to "DH/RTP/TCP;unicast;interleaved=0-1"))
        val setup = readResponse()
        sessionId = setup.headers["session"]?.split(";")?.firstOrNull()?.trim()
        Log.d(TAG, "SETUP -> ${setup.status} session=$sessionId")
        sendRtsp("PLAY", "$url/", mapOf("Session" to (sessionId ?: ""), "Range" to playRange))
        Log.d(TAG, "PLAY -> ${readResponse().status}")
    }

    private data class Resp(val status: String, val headers: Map<String, String>, val body: ByteArray)

    private fun sendRtsp(method: String, u: String, headers: Map<String, String>) {
        cseq += 1
        val sb = StringBuilder()
        sb.append("$method $u RTSP/1.0\r\n")
        sb.append("CSeq: $cseq\r\n")
        sb.append("User-Agent: pkt-live-android/0.1\r\n")
        for ((k, v) in headers) sb.append("$k: $v\r\n")
        sb.append("\r\n")
        output!!.write(sb.toString().toByteArray(Charsets.UTF_8)); output!!.flush()
    }

    private fun ensure(n: Int) {
        val tmp = ByteArray(65536)
        while (bufLen < n) {
            val r = input!!.read(tmp)
            if (r < 0) throw RuntimeException("closed")
            appendBuf(tmp, r)
        }
    }

    private fun appendBuf(src: ByteArray, len: Int) {
        if (bufLen + len > buf.size) {
            buf = buf.copyOf(maxOf(buf.size * 2, bufLen + len, 128 * 1024))
        }
        System.arraycopy(src, 0, buf, bufLen, len)
        bufLen += len
    }

    private fun consume(n: Int) {
        System.arraycopy(buf, n, buf, 0, bufLen - n); bufLen -= n
    }

    private fun indexOfCRLFCRLF(): Int {
        for (i in 0..bufLen - 4) {
            if (buf[i] == 13.toByte() && buf[i + 1] == 10.toByte() &&
                buf[i + 2] == 13.toByte() && buf[i + 3] == 10.toByte()) return i
        }
        return -1
    }

    private fun readResponse(): Resp {
        var hdrEnd = indexOfCRLFCRLF()
        while (hdrEnd < 0) {
            val tmp = ByteArray(65536); val r = input!!.read(tmp)
            if (r < 0) throw RuntimeException("closed"); appendBuf(tmp, r); hdrEnd = indexOfCRLFCRLF()
        }
        val headText = String(buf, 0, hdrEnd, Charsets.UTF_8)
        consume(hdrEnd + 4)
        val lines = headText.split("\r\n")
        val status = lines.firstOrNull() ?: ""
        val headers = HashMap<String, String>()
        var contentLength = 0
        for (line in lines.drop(1)) {
            val idx = line.indexOf(':'); if (idx <= 0) continue
            val k = line.substring(0, idx).trim().lowercase()
            val v = line.substring(idx + 1).trim()
            headers[k] = v
            if (k == "content-length") contentLength = v.toIntOrNull() ?: 0
        }
        if (contentLength > 0) ensure(contentLength)
        val body = buf.copyOfRange(0, contentLength); if (contentLength > 0) consume(contentLength)
        return Resp(status, headers, body)
    }

    /** Gọi onChunk cho mỗi payload DHAV (video). Trả false từ closure để dừng. */
    fun runChunkLoop(onChunk: (ByteArray) -> Boolean) {
        val keepAudio = audio
        var keepGoing = true
        val tmp = ByteArray(65536)
        while (keepGoing && !closed) {
            // Tiêu thụ các gói interleaved đang có trong buf.
            while (bufLen >= 4 && buf[0] == '$'.code.toByte()) {
                val ch = buf[1].toInt() and 0xff
                val len = ((buf[2].toInt() and 0xff) shl 8) or (buf[3].toInt() and 0xff)
                if (bufLen < 4 + len) break
                val isVideo = ch == 0
                val isAudio = ch == 2
                if ((isVideo || (keepAudio && isAudio)) && len > 12) {
                    val payload = buf.copyOfRange(4 + 12, 4 + len) // bỏ 12B RTP hdr
                    consume(4 + len)
                    if (!onChunk(payload)) { keepGoing = false; break }
                } else {
                    consume(4 + len)
                }
            }
            if (!keepGoing) break
            // Resync nếu byte đầu không phải '$'.
            if (bufLen > 0 && buf[0] != '$'.code.toByte()) {
                var d = -1
                for (i in 0 until bufLen) if (buf[i] == '$'.code.toByte()) { d = i; break }
                if (d > 0) consume(d) else { bufLen = 0 }
            }
            val r = try { input!!.read(tmp) } catch (e: Exception) {
                if (closed) return; Log.w(TAG, "recv: $e"); throw e
            }
            if (r < 0) throw RuntimeException("closed")
            appendBuf(tmp, r)
        }
    }

    fun close() {
        closed = true
        try { sessionId?.let { sendRtsp("TEARDOWN", url, mapOf("Session" to it)) } } catch (_: Exception) {}
        try { sock?.close() } catch (_: Exception) {}
    }

    companion object { private const val TAG = "DhRtspClient" }
}

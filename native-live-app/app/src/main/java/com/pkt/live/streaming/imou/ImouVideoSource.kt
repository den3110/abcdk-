package com.pkt.live.streaming.imou

import android.graphics.SurfaceTexture
import android.media.MediaCodec
import android.media.MediaFormat
import android.util.Log
import android.view.Surface
import com.pedro.encoder.input.sources.video.VideoSource
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking

/**
 * Nguồn cam Imou CLOUD cho RootEncoder (Android, tương đương ImouLiveSource iOS).
 * urlProvider: suspend lấy relay URL từ backend (court-imou-stream-url).
 * Luồng: DhRtspClient (DHAV/TCP) → DhavParser.Assembler → payload Annex-B →
 * MediaCodec (decode thẳng vào Surface của encoder) → RootEncoder → RTMP → FB.
 */
class ImouVideoSource(
    private val urlProvider: suspend () -> String,
    private val onError: (String) -> Unit = {},
    private val onFrames: (Int) -> Unit = {},
) : VideoSource() {

    @Volatile private var running = false
    private var surface: Surface? = null
    private var job: Job? = null
    private var rtsp: DhRtspClient? = null
    private var codec: MediaCodec? = null
    private var codecMime: String? = null
    private var frameCount = 0
    private val scope = CoroutineScope(Dispatchers.IO)

    override fun create(width: Int, height: Int, fps: Int, rotation: Int): Boolean = true

    override fun start(surfaceTexture: SurfaceTexture) {
        surfaceTexture.setDefaultBufferSize(width, height)
        surface = Surface(surfaceTexture)
        running = true
        job = scope.launch { runLoop() }
    }

    private suspend fun runLoop() {
        while (running) {
            try {
                val url = urlProvider()
                Log.d(TAG, "streamUrl OK: ${url.take(70)}…")
                val client = DhRtspClient(url, audio = false)
                rtsp = client
                client.open()
                Log.d(TAG, "rtsp open → chunk loop")
                val asm = DhavParser.Assembler()
                var chunks = 0
                client.runChunkLoop { chunk ->
                    if (!running) return@runChunkLoop false
                    chunks++
                    asm.push(chunk)
                    for (frame in asm.popFrames()) {
                        val t = DhavParser.frameType(frame)
                        if (t == DhavParser.TYPE_AUDIO) continue
                        val payload = DhavParser.extractPayload(frame) ?: continue
                        feed(payload)
                    }
                    true
                }
                if (!running) break
                Log.d(TAG, "chunk loop kết thúc — mở lại")
            } catch (e: Exception) {
                if (!running) break
                Log.e(TAG, "runLoop error: $e")
                onError(e.message ?: "lỗi kết nối cam Imou")
            } finally {
                try { rtsp?.close() } catch (_: Exception) {}
            }
            // reconnect ngay ở mép live (URL mới) — chống trễ dồn.
        }
        releaseCodec()
    }

    /** Nhận diện codec từ NAL đầu (H264 vs H265), cấu hình MediaCodec 1 lần rồi feed. */
    private fun feed(payload: ByteArray) {
        val c = codec ?: run {
            val mime = detectMime(payload) ?: return
            configureCodec(mime) ?: return
        }
        try {
            val inIdx = c.dequeueInputBuffer(10_000)
            if (inIdx >= 0) {
                val bb = c.getInputBuffer(inIdx)
                bb?.clear(); bb?.put(payload)
                val ptsUs = System.nanoTime() / 1000
                c.queueInputBuffer(inIdx, 0, payload.size, ptsUs, 0)
            }
            val info = MediaCodec.BufferInfo()
            var outIdx = c.dequeueOutputBuffer(info, 0)
            while (outIdx >= 0) {
                c.releaseOutputBuffer(outIdx, true)   // render vào Surface
                frameCount++
                if (frameCount % 30 == 0) onFrames(frameCount)
                outIdx = c.dequeueOutputBuffer(info, 0)
            }
        } catch (e: Exception) {
            Log.w(TAG, "feed error: $e")
        }
    }

    private fun configureCodec(mime: String): MediaCodec? {
        return try {
            releaseCodec()
            val mc = MediaCodec.createDecoderByType(mime)
            val fmt = MediaFormat.createVideoFormat(mime, if (width > 0) width else 1920,
                if (height > 0) height else 1080)
            mc.configure(fmt, surface, null, 0)  // decode thẳng ra Surface
            mc.start()
            codec = mc; codecMime = mime
            Log.d(TAG, "MediaCodec $mime started")
            mc
        } catch (e: Exception) {
            Log.e(TAG, "configureCodec fail: $e"); onError("decode $mime lỗi: ${e.message}"); null
        }
    }

    /** Tìm NAL đầu (bỏ start code), suy codec. H264 byte0 ∈ {0x67,0x68,0x65,0x61,0x41} else HEVC. */
    private fun detectMime(payload: ByteArray): String? {
        var i = 0
        while (i < payload.size - 4) {
            val sc3 = payload[i].toInt() == 0 && payload[i + 1].toInt() == 0 && payload[i + 2].toInt() == 1
            val sc4 = payload[i].toInt() == 0 && payload[i + 1].toInt() == 0 &&
                payload[i + 2].toInt() == 0 && payload[i + 3].toInt() == 1
            if (sc3 || sc4) {
                val b = payload[i + (if (sc4) 4 else 3)].toInt() and 0xff
                return if (b == 0x67 || b == 0x68 || b == 0x65 || b == 0x61 || b == 0x41)
                    MediaFormat.MIMETYPE_VIDEO_AVC else MediaFormat.MIMETYPE_VIDEO_HEVC
            }
            i++
        }
        return null
    }

    private fun releaseCodec() {
        try { codec?.stop() } catch (_: Exception) {}
        try { codec?.release() } catch (_: Exception) {}
        codec = null; codecMime = null
    }

    override fun stop() {
        running = false
        try { rtsp?.close() } catch (_: Exception) {}
        job?.cancel()
        // release codec trên chính thread IO ở cuối runLoop; nếu runLoop đã dừng thì release ở đây.
        if (job?.isActive != true) releaseCodec()
        surface?.release(); surface = null
    }

    override fun release() { stop() }

    override fun isRunning(): Boolean = running

    companion object { private const val TAG = "ImouVideoSource" }
}

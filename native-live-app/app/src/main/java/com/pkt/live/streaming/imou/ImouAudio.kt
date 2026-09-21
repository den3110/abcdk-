package com.pkt.live.streaming.imou

import android.media.MediaCodec
import android.media.MediaFormat
import android.util.Log
import com.pedro.encoder.Frame
import com.pedro.encoder.input.audio.GetMicrophoneData
import com.pedro.encoder.input.sources.audio.AudioSource
import java.nio.ByteBuffer

/**
 * Nguồn audio "ngoài" cho RootEncoder: nhận PCM đã giải mã (từ cam Imou/RTSP) rồi
 * đẩy vào encoder qua GetMicrophoneData.inputPCMData. RootEncoder gọi create() với
 * sampleRate/stereo mong muốn (từ prepareAudio) → ImouAudioDecoder resample về đúng.
 */
class ExternalPcmAudioSource : AudioSource() {
    @Volatile private var cb: GetMicrophoneData? = null
    @Volatile private var running = false
    var outSampleRate = 44100; private set
    var outStereo = true; private set

    override fun create(sampleRate: Int, isStereo: Boolean, echoCanceler: Boolean, noiseSuppressor: Boolean): Boolean {
        outSampleRate = sampleRate; outStereo = isStereo; return true
    }
    override fun start(getMicrophoneData: GetMicrophoneData) { cb = getMicrophoneData; running = true }
    override fun stop() { running = false }
    override fun isRunning(): Boolean = running
    override fun release() { cb = null }

    fun push(pcm: ByteArray, size: Int, tsUs: Long) {
        if (running) runCatching { cb?.inputPCMData(Frame(pcm, 0, size, tsUs)) }
    }
}

/**
 * Giải mã AAC (ADTS) từ DHAV audio frame (0xf0) → PCM 16-bit → resample về
 * outSampleRate/outStereo → đẩy vào ExternalPcmAudioSource.
 */
class ImouAudioDecoder(private val sink: ExternalPcmAudioSource) {
    private var codec: MediaCodec? = null
    private var srcRate = 0
    private var srcCh = 0
    private val rates = intArrayOf(96000,88200,64000,48000,44100,32000,24000,22050,16000,12000,11025,8000,7350)

    /** Nạp 1 payload ADTS AAC (đã strip DHAV wrapper). */
    fun feed(adts: ByteArray) {
        if (adts.size < 7 || (adts[0].toInt() and 0xff) != 0xff || (adts[1].toInt() and 0xf0) != 0xf0) return
        if (codec == null) configure(adts)
        val c = codec ?: return
        val protectionAbsent = (adts[1].toInt() and 0x01) == 1
        val hdrLen = if (protectionAbsent) 7 else 9
        if (adts.size <= hdrLen) return
        try {
            val inIdx = c.dequeueInputBuffer(5_000)
            if (inIdx >= 0) {
                val bb = c.getInputBuffer(inIdx)
                bb?.clear(); bb?.put(adts, hdrLen, adts.size - hdrLen)
                c.queueInputBuffer(inIdx, 0, adts.size - hdrLen, System.nanoTime() / 1000, 0)
            }
            drain(c)
        } catch (e: Exception) { Log.w(TAG, "audio feed: $e") }
    }

    private fun configure(adts: ByteArray) {
        val b2 = adts[2].toInt() and 0xff
        val b3 = adts[3].toInt() and 0xff
        val srIdx = (b2 shr 2) and 0x0f
        val ch = ((b2 and 0x01) shl 2) or ((b3 shr 6) and 0x03)
        srcRate = rates.getOrElse(srIdx) { 16000 }
        srcCh = if (ch in 1..8) ch else 1
        try {
            val mc = MediaCodec.createDecoderByType(MediaFormat.MIMETYPE_AUDIO_AAC)
            val fmt = MediaFormat.createAudioFormat(MediaFormat.MIMETYPE_AUDIO_AAC, srcRate, srcCh)
            fmt.setInteger(MediaFormat.KEY_IS_ADTS, 1)
            mc.configure(fmt, null, null, 0)
            mc.start()
            codec = mc
            Log.d(TAG, "AAC decoder $srcRate Hz ${srcCh}ch")
        } catch (e: Exception) { Log.e(TAG, "audio configure: $e") }
    }

    private val info = MediaCodec.BufferInfo()
    private fun drain(c: MediaCodec) {
        var outIdx = c.dequeueOutputBuffer(info, 0)
        while (outIdx >= 0) {
            val buf = c.getOutputBuffer(outIdx)
            if (buf != null && info.size > 0) {
                val pcm = ByteArray(info.size)
                buf.position(info.offset); buf.get(pcm, 0, info.size)
                val out = resample(pcm)
                sink.push(out, out.size, System.nanoTime() / 1000)
            }
            c.releaseOutputBuffer(outIdx, false)
            outIdx = c.dequeueOutputBuffer(info, 0)
        }
    }

    /** PCM16 srcRate/srcCh → outRate/outCh (linear resample + mono↔stereo). */
    private fun resample(src: ByteArray): ByteArray {
        val outRate = sink.outSampleRate
        val outCh = if (sink.outStereo) 2 else 1
        if (srcRate == outRate && srcCh == outCh) return src
        val inSamples = src.size / 2 / srcCh
        if (inSamples <= 0) return src
        val sb = ByteBuffer.wrap(src).order(java.nio.ByteOrder.LITTLE_ENDIAN).asShortBuffer()
        val outSamples = (inSamples.toLong() * outRate / srcRate).toInt().coerceAtLeast(1)
        val out = ByteArray(outSamples * 2 * outCh)
        val ob = ByteBuffer.wrap(out).order(java.nio.ByteOrder.LITTLE_ENDIAN).asShortBuffer()
        for (i in 0 until outSamples) {
            val srcPos = (i.toLong() * srcRate / outRate).toInt().coerceIn(0, inSamples - 1)
            // lấy mẫu kênh 0 (mono hoá nếu src stereo)
            val s0 = sb.get(srcPos * srcCh)
            if (outCh == 2) { ob.put(s0); ob.put(s0) } else ob.put(s0)
        }
        return out
    }

    fun release() {
        try { codec?.stop() } catch (_: Exception) {}
        try { codec?.release() } catch (_: Exception) {}
        codec = null
    }

    companion object { private const val TAG = "ImouAudioDecoder" }
}

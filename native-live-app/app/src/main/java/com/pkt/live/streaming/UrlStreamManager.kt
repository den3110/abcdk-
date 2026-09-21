package com.pkt.live.streaming

import android.content.Context
import android.graphics.Bitmap
import android.util.Log
import com.pedro.common.ConnectChecker
import com.pedro.encoder.input.gl.render.filters.`object`.ImageObjectFilterRender
import com.pedro.encoder.input.sources.audio.NoAudioSource
import com.pedro.library.generic.GenericStream
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/**
 * Path phát live từ 1 LINK (m3u8/HLS/RTSP/HTTP) — song song với RtmpStreamManager
 * (camera). Dùng RootEncoder GenericStream + ExoPlayerVideoSource làm nguồn video,
 * NoAudioSource (nguồn link không kèm tiếng vào stream — như bản server). Overlay
 * điểm số/logo tái dùng OverlayBitmapRenderer → ImageObjectFilterRender như camera.
 *
 * MVP: 1 đích RTMP (FB). Chưa đa đích/recording (đường camera lo việc đó).
 */
class UrlStreamManager(
    private val context: Context,
) : ConnectChecker {

    sealed class State {
        data object Idle : State()
        data class Connecting(val url: String) : State()
        data object Connected : State()
        data class Failed(val reason: String) : State()
        data class SourceError(val reason: String) : State()
    }

    private val _state = MutableStateFlow<State>(State.Idle)
    val state: StateFlow<State> = _state

    private var stream: GenericStream? = null
    private var overlayFilter: ImageObjectFilterRender? = null
    private var rtmpUrl: String = ""

    private var width = 1920
    private var height = 1080
    private var fps = 30
    private var bitrate = 4_500_000

    /**
     * Chuẩn bị stream: mở link (ExoPlayer) làm nguồn, prepare encoder.
     * @param sourceUrl link m3u8/rtsp/http; @param rtmp đích FB (rtmp://…/key).
     */
    fun prepare(sourceUrl: String, rtmp: String, w: Int, h: Int, videoFps: Int, videoBitrate: Int): Boolean {
        val videoSource = ExoPlayerVideoSource(
            context = context,
            url = sourceUrl,
            onError = { msg -> _state.value = State.SourceError(msg) },
            onReady = { Log.d(TAG, "url source ready") },
        )
        return prepareWith(videoSource, rtmp, w, h, videoFps, videoBitrate)
    }

    /** Nguồn cam Imou cloud: urlProvider suspend lấy relay URL từ backend. */
    fun prepareImou(urlProvider: suspend () -> String, rtmp: String,
                    w: Int, h: Int, videoFps: Int, videoBitrate: Int): Boolean {
        val videoSource = com.pkt.live.streaming.imou.ImouVideoSource(
            urlProvider = urlProvider,
            onError = { msg -> _state.value = State.SourceError(msg) },
        )
        return prepareWith(videoSource, rtmp, w, h, videoFps, videoBitrate)
    }

    private fun prepareWith(videoSource: com.pedro.encoder.input.sources.video.VideoSource,
                            rtmp: String, w: Int, h: Int, videoFps: Int, videoBitrate: Int): Boolean {
        rtmpUrl = rtmp
        width = w; height = h; fps = videoFps; bitrate = videoBitrate
        val s = GenericStream(context, this, videoSource, NoAudioSource())
        stream = s
        val vOk = runCatching {
            s.prepareVideo(width, height, bitrate, fps, 2, 0)
        }.getOrElse { Log.e(TAG, "prepareVideo throw: $it"); false }
        val aOk = runCatching { s.prepareAudio(32000, true, 128_000) }.getOrDefault(true)
        Log.d(TAG, "prepare vOk=$vOk aOk=$aOk")
        return vOk
    }

    /** Cập nhật overlay (bitmap điểm số/logo) — gọi mỗi khi score đổi. */
    fun setOverlay(bitmap: Bitmap) {
        val s = stream ?: return
        try {
            if (overlayFilter == null) {
                val f = ImageObjectFilterRender()
                s.getGlInterface().setFilter(f)
                overlayFilter = f
            }
            overlayFilter?.setImage(bitmap)
        } catch (t: Throwable) {
            Log.w(TAG, "setOverlay fail: $t")
        }
    }

    fun start() {
        val s = stream ?: return
        if (s.isStreaming) return
        _state.value = State.Connecting(rtmpUrl)
        runCatching { s.startStream(rtmpUrl) }
            .onFailure { _state.value = State.Failed(it.message ?: "startStream error") }
    }

    fun stop() {
        val s = stream ?: return
        runCatching { if (s.isStreaming) s.stopStream() }
        runCatching { s.release() }
        stream = null
        overlayFilter = null
        _state.value = State.Idle
    }

    // ConnectChecker
    override fun onConnectionStarted(url: String) { Log.d(TAG, "conn started") }
    override fun onConnectionSuccess() { _state.value = State.Connected }
    override fun onConnectionFailed(reason: String) { _state.value = State.Failed(reason) }
    override fun onDisconnect() { _state.value = State.Idle }
    override fun onAuthError() { _state.value = State.Failed("auth error") }
    override fun onAuthSuccess() { Log.d(TAG, "auth ok") }
    override fun onNewBitrate(bitrate: Long) { /* theo dõi nếu cần */ }

    companion object { private const val TAG = "UrlStreamManager" }
}

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

    var isPrepared: Boolean = false
        private set

    /** Chuẩn bị nguồn cam Imou (chưa cần rtmp — rtmp truyền khi startStream). */
    fun prepareImou(urlProvider: suspend () -> String, w: Int, h: Int, videoFps: Int, videoBitrate: Int): Boolean {
        val videoSource = com.pkt.live.streaming.imou.ImouVideoSource(
            urlProvider = urlProvider,
            onError = { msg -> _state.value = State.SourceError(msg) },
        )
        return prepareWith(videoSource, w, h, videoFps, videoBitrate)
    }

    /** Chuẩn bị nguồn LINK (m3u8/RTSP/HTTP). */
    fun prepareUrl(sourceUrl: String, w: Int, h: Int, videoFps: Int, videoBitrate: Int): Boolean {
        val videoSource = ExoPlayerVideoSource(
            context = context, url = sourceUrl,
            onError = { msg -> _state.value = State.SourceError(msg) },
        )
        return prepareWith(videoSource, w, h, videoFps, videoBitrate)
    }

    private fun prepareWith(videoSource: com.pedro.encoder.input.sources.video.VideoSource,
                            w: Int, h: Int, videoFps: Int, videoBitrate: Int): Boolean {
        stop() // dọn stream cũ nếu có
        // Nguồn ngoài (Imou/link) LUÔN landscape → ép width>height, rotation=0.
        width = maxOf(w, h); height = minOf(w, h); fps = videoFps; bitrate = videoBitrate
        val s = GenericStream(context, this, videoSource, NoAudioSource())
        stream = s
        val vOk = runCatching {
            s.prepareVideo(width, height, bitrate, fps, 2, 0)
        }.getOrElse { Log.e(TAG, "prepareVideo throw: $it"); false }
        val aOk = runCatching { s.prepareAudio(32000, true, 128_000) }.getOrDefault(true)
        isPrepared = vOk
        Log.d(TAG, "prepare vOk=$vOk aOk=$aOk")
        return vOk
    }

    /** Xem trước nguồn (chạy VideoSource + render vào view) — TRƯỚC khi go live. */
    fun startPreview(view: android.view.TextureView) {
        val s = stream ?: return
        // autoHandleOrientation=false: nguồn ngoài đã landscape sẵn, KHÔNG xoay theo cảm biến.
        runCatching { if (!s.isOnPreview) s.startPreview(view, false) }
            .onFailure { Log.w(TAG, "startPreview fail: $it") }
    }

    fun stopPreview() {
        runCatching { stream?.let { if (it.isOnPreview) it.stopPreview() } }
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

    /** Bắt đầu phát tới rtmp (nguồn đã prepare + có thể đang preview). */
    fun startStream(rtmp: String) {
        val s = stream ?: return
        if (s.isStreaming) return
        rtmpUrl = rtmp
        _state.value = State.Connecting(rtmp)
        runCatching { s.startStream(rtmp) }
            .onFailure { _state.value = State.Failed(it.message ?: "startStream error") }
    }

    fun stop() {
        val s = stream ?: return
        runCatching { if (s.isStreaming) s.stopStream() }
        runCatching { if (s.isOnPreview) s.stopPreview() }
        runCatching { s.release() }
        stream = null
        overlayFilter = null
        isPrepared = false
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

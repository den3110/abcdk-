package com.pkt.live.streaming

import android.content.Context
import android.graphics.SurfaceTexture
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.Surface
import androidx.annotation.OptIn
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import com.pedro.encoder.input.sources.video.VideoSource

/**
 * Nguồn video cho RootEncoder từ 1 LINK (m3u8/HLS, RTSP, HTTP progressive) qua
 * ExoPlayer. RootEncoder cấp cho ta 1 SurfaceTexture (surface input của encoder GL);
 * ta bảo ExoPlayer render thẳng vào đó → khung hình chảy vào encoder → RTMP → FB.
 *
 * RTSP hoạt động vì đã thêm media3-exoplayer-rtsp; HLS qua media3-exoplayer-hls.
 */
@OptIn(UnstableApi::class)
class ExoPlayerVideoSource(
    private val context: Context,
    private val url: String,
    private val onError: (String) -> Unit = {},
    private val onReady: () -> Unit = {},
) : VideoSource() {

    private var player: ExoPlayer? = null
    private var surface: Surface? = null
    @Volatile private var running = false
    private val main = Handler(Looper.getMainLooper())

    override fun create(width: Int, height: Int, fps: Int, rotation: Int): Boolean {
        // Chấp nhận mọi kích thước; ExoPlayer scale khung nguồn vào surface encoder.
        return true
    }

    override fun start(surfaceTexture: SurfaceTexture) {
        surfaceTexture.setDefaultBufferSize(width, height)
        val surf = Surface(surfaceTexture)
        surface = surf
        running = true
        main.post {
            val p = ExoPlayer.Builder(context).build()
            p.setVideoSurface(surf)
            p.volume = 0f
            p.addListener(object : Player.Listener {
                override fun onPlaybackStateChanged(state: Int) {
                    if (state == Player.STATE_READY) {
                        Log.d(TAG, "ExoPlayer READY")
                        onReady()
                    }
                }
                override fun onPlayerError(error: PlaybackException) {
                    Log.e(TAG, "ExoPlayer error ${error.errorCodeName}: ${error.message}")
                    onError("${error.errorCodeName}: ${error.message ?: ""}")
                }
            })
            p.setMediaItem(MediaItem.fromUri(url))
            p.prepare()
            p.playWhenReady = true
            player = p
        }
    }

    override fun stop() {
        running = false
        main.post {
            player?.release()
            player = null
        }
        surface?.release()
        surface = null
    }

    override fun release() { stop() }

    override fun isRunning(): Boolean = running

    companion object { private const val TAG = "ExoUrlSource" }
}

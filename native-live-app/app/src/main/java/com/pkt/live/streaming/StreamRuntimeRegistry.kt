package com.pkt.live.streaming

import java.util.concurrent.atomic.AtomicReference

class StreamRuntimeRegistry {
    private val activeStreamManager = AtomicReference<RtmpStreamManager?>(null)
    private val activeOverlayRenderer = AtomicReference<OverlayBitmapRenderer?>(null)

    fun register(streamManager: RtmpStreamManager? = null, overlayRenderer: OverlayBitmapRenderer? = null) {
        streamManager?.let { activeStreamManager.set(it) }
        overlayRenderer?.let { activeOverlayRenderer.set(it) }
    }

    fun unregister(streamManager: RtmpStreamManager? = null, overlayRenderer: OverlayBitmapRenderer? = null) {
        streamManager?.let {
            activeStreamManager.compareAndSet(it, null)
        }
        overlayRenderer?.let {
            activeOverlayRenderer.compareAndSet(it, null)
        }
    }

    fun activeStreamManager(): RtmpStreamManager? = activeStreamManager.get()

    fun activeOverlayRenderer(): OverlayBitmapRenderer? = activeOverlayRenderer.get()
}

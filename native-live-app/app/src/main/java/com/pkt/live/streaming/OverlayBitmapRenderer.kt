package com.pkt.live.streaming

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.PorterDuff
import android.graphics.Rect
import android.graphics.RectF
import android.graphics.Typeface
import android.os.Handler
import android.os.HandlerThread
import android.util.Log
import com.pkt.live.BuildConfig
import com.pkt.live.data.model.OverlayData
import com.pkt.live.util.normalizeOverlayNameStyle
import com.pkt.live.util.overlayTeamNameCandidates
import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.URL
import com.google.firebase.crashlytics.FirebaseCrashlytics
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference
import java.util.concurrent.Executors
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.supervisorScope
import kotlinx.coroutines.asCoroutineDispatcher

/**
 * Renders a single full-frame overlay bitmap for both preview and RTMP output.
 *
 * This avoids the previous split between Compose-only preview overlays and GL-only
 * branding filters, so what the operator sees on-device matches the encoded video.
 */
class OverlayBitmapRenderer(
    @Suppress("UNUSED_PARAMETER") private val context: android.content.Context,
    private val runtimeRegistry: StreamRuntimeRegistry,
) {
    companion object {
        private const val TAG = "OverlayBitmapRenderer"
        private const val CLOCK_RENDER_INTERVAL_MS = 1_000L
        private const val DEFAULT_OUTPUT_WIDTH = 1280
        private const val DEFAULT_OUTPUT_HEIGHT = 720
        private const val SCOREBOARD_WIDTH = 520
        private const val SCOREBOARD_HEIGHT = 160
        private const val SCOREBOARD_DISPLAY_SCALE = 0.75f
        private const val MAX_SPONSORS = 8
        private const val BRANDING_CONNECT_TIMEOUT_MS = 4_000
        private const val BRANDING_READ_TIMEOUT_MS = 4_000
        private const val BRANDING_DOWNLOAD_CONCURRENCY = 3
        private const val MAX_BRANDING_DOWNLOAD_BYTES = 4 * 1024 * 1024
        // Anti-crash: prevent bitmap allocation larger than 4K to avoid OOM on low-RAM devices
        private const val MAX_BITMAP_DIMENSION = 3840

        // Server-driven overlay widgets
        private const val MAX_OVERLAY_WIDGETS = 6
        private const val WIDGET_IMAGE_MAX_PX = 640
        private const val WIDGET_PENDING_RETRY_MS = 15_000L
    }

    private val renderThread = HandlerThread("OverlayRender").also { it.start() }
    private val renderHandler = Handler(renderThread.looper)
    private val brandingThread = HandlerThread("OverlayBranding").also { it.start() }
    private val brandingHandler = Handler(brandingThread.looper)
    private val brandingExecutor = Executors.newFixedThreadPool(BRANDING_DOWNLOAD_CONCURRENCY)
    private val brandingDispatcher = brandingExecutor.asCoroutineDispatcher()

    private val currentData = AtomicReference(OverlayData())
    private val lastRenderedData = AtomicReference<OverlayData?>(null)
    private val lastRenderedBrandingKey = AtomicReference("")
    private val currentOutputSize =
        AtomicReference(RenderSize(width = DEFAULT_OUTPUT_WIDTH, height = DEFAULT_OUTPUT_HEIGHT))
    private val isRunning = AtomicBoolean(false)
    private val isReleased = AtomicBoolean(false)
    private val renderScheduled = AtomicBoolean(false)

    private var frontBitmap: Bitmap? = null
    private var backBitmap: Bitmap? = null
    private var scoreboardBitmap: Bitmap? = null
    private val bitmapLock = Any()

    private var cachedLogoUrl = ""
    private var cachedSponsorKey = ""
    private var pendingBrandingKey = ""
    private var logoBitmap: Bitmap? = null
    private var sponsorBarBitmap: Bitmap? = null

    // Widget overlay điều khiển từ server — cache ảnh theo url (guard bởi bitmapLock)
    private var cachedWidgetKey = ""
    private var pendingWidgetKey = ""
    private var pendingWidgetSinceMs = 0L
    private val widgetBitmaps = HashMap<String, Bitmap>()
    private val _brandingLoadState = MutableStateFlow(BrandingLoadState())
    val brandingLoadState: StateFlow<BrandingLoadState> = _brandingLoadState.asStateFlow()

    var onBitmapReady: ((Bitmap) -> Unit)? = null

    init {
        runtimeRegistry.register(overlayRenderer = this)
    }

    private val imagePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        isFilterBitmap = true
    }
    private val fillPaint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val topBarPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.BLACK
        textSize = 22f
        typeface = Typeface.DEFAULT_BOLD
        textAlign = Paint.Align.CENTER
    }
    private val namePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.WHITE
        textSize = 28f
        typeface = Typeface.DEFAULT_BOLD
    }
    private val seedPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.WHITE
        textSize = 22f
    }
    private val scorePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.WHITE
        textSize = 42f
        typeface = Typeface.DEFAULT_BOLD
        textAlign = Paint.Align.CENTER
    }
    private val serveDotPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.parseColor("#22C55E")
        style = Paint.Style.FILL
    }
    private val subPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.parseColor("#9AA4AF")
        textSize = 18f
    }
    private val logoBgPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.argb(90, 0, 0, 0)
    }
    private val widgetImagePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        isFilterBitmap = true
    }
    private val widgetTextPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        typeface = Typeface.DEFAULT_BOLD
        textAlign = Paint.Align.LEFT
    }
    private val widgetBgPaint = Paint(Paint.ANTI_ALIAS_FLAG)

    private data class RenderSize(
        val width: Int,
        val height: Int,
    )

    data class BrandingLoadState(
        val isLoading: Boolean = false,
        val logoRequested: Boolean = false,
        val logoReady: Boolean = false,
        val sponsorsRequested: Int = 0,
        val sponsorsReady: Boolean = false,
        val requestKey: String = "",
        val lastFinishedAtMs: Long = 0L,
    )

    fun updateData(data: OverlayData) {
        val previous = currentData.getAndSet(data)
        requestBrandingAssets(data)
        requestWidgetAssets(data)
        // Skip render if data hasn't changed — prevents flickering from duplicate socket payloads
        if (previous == data) return
        lastRenderedData.set(null) // invalidate cache so next renderFrame() actually pushes
        scheduleRender()
    }

    fun refresh() {
        // Only schedule if we haven't already rendered the current data
        // This prevents redundant bitmap pushes from the keep-alive observer
        val data = currentData.get()
        val lastRendered = lastRenderedData.get()
        val brandingKey = buildBrandingFingerprint(data)
        if (lastRendered != null && lastRendered == data && brandingKey == lastRenderedBrandingKey.get()) {
            return
        }
        scheduleRender()
    }

    fun forceRefresh() {
        lastRenderedData.set(null)
        lastRenderedBrandingKey.set("")
        scheduleRender()
    }

    private fun buildBrandingFingerprint(data: OverlayData): String {
        val logoOk = synchronized(bitmapLock) { logoBitmap?.isRecycled == false }
        val sponsorOk = synchronized(bitmapLock) { sponsorBarBitmap?.isRecycled == false }
        return "${data.webLogoUrl ?: data.tournamentLogoUrl}|$logoOk|${data.sponsorLogos.joinToString(",")}|$sponsorOk"
    }

    fun updateOutputSize(width: Int, height: Int) {
        val safeWidth = width.coerceAtLeast(1)
        val safeHeight = height.coerceAtLeast(1)
        val next = RenderSize(width = safeWidth, height = safeHeight)
        if (currentOutputSize.getAndSet(next) != next) {
            scheduleRender()
        }
    }

    fun start() {
        if (isReleased.get()) {
            Log.w(TAG, "start() ignored after release")
            return
        }
        if (isRunning.getAndSet(true)) return
        Log.d(TAG, "Overlay renderer started")
        scheduleRender()
    }

    fun stop() {
        isRunning.set(false)
        renderScheduled.set(false)
        renderHandler.removeCallbacksAndMessages(null)
        brandingHandler.removeCallbacksAndMessages(null)
        synchronized(bitmapLock) {
            clearBitmapsLocked(clearBranding = true)
        }
        Log.d(TAG, "Overlay renderer stopped")
    }

    fun trimMemory() {
        synchronized(bitmapLock) {
            clearBitmapsLocked(clearBranding = true)
        }
        if (isRunning.get()) {
            scheduleRender(delayMs = CLOCK_RENDER_INTERVAL_MS)
        }
    }

    fun release() {
        if (!isReleased.compareAndSet(false, true)) return
        runtimeRegistry.unregister(overlayRenderer = this)
        onBitmapReady = null
        stop()
        renderThread.quitSafely()
        brandingThread.quitSafely()
        brandingDispatcher.close()
        brandingExecutor.shutdownNow()
    }

    private fun scheduleRender(delayMs: Long = 0L) {
        if (!isRunning.get() || isReleased.get()) return
        // Fix #4: Guard against posting to a dead HandlerThread
        if (!renderThread.isAlive) {
            Log.w(TAG, "renderThread is dead, skipping scheduleRender")
            return
        }
        if (renderScheduled.getAndSet(true)) return
        runCatching {
            renderHandler.postDelayed({
                renderScheduled.set(false)
                if (isReleased.get()) return@postDelayed
                renderFrame()
            }, delayMs.coerceAtLeast(0L))
        }.onSuccess { posted ->
            if (!posted) {
                renderScheduled.set(false)
                Log.w(TAG, "Overlay render was not scheduled")
            }
        }.onFailure {
            renderScheduled.set(false)
            Log.e(TAG, "Failed to post overlay render", it)
        }
    }

    private fun renderFrame() {
        if (!isRunning.get() || isReleased.get()) return

        try {
            val data = currentData.get()
            if (!data.overlayEnabled) {
                val output = synchronized(bitmapLock) {
                    val output = obtainOutputBitmapLocked() ?: return
                    Canvas(output).drawColor(Color.TRANSPARENT, PorterDuff.Mode.CLEAR)
                    val temp = frontBitmap
                    frontBitmap = backBitmap
                    backBitmap = temp
                    output
                }
                onBitmapReady?.invoke(output)
                return
            }

            val output = synchronized(bitmapLock) {
                val outputBitmap = obtainOutputBitmapLocked() ?: return
                val scoreboard = obtainScoreboardBitmapLocked() ?: return

                val scoreboardCanvas = Canvas(scoreboard)
                scoreboardCanvas.drawColor(Color.TRANSPARENT, PorterDuff.Mode.CLEAR)
                if (data.isBreak) {
                    drawBreakCard(scoreboardCanvas, data)
                } else {
                    drawV2Scoreboard(scoreboardCanvas, data)
                }

                val canvas = Canvas(outputBitmap)
                canvas.drawColor(Color.TRANSPARENT, PorterDuff.Mode.CLEAR)

                val uiScale = minOf(outputBitmap.width / 1280f, outputBitmap.height / 720f)
                val margin = 16f * uiScale

                drawScoreboardLayer(canvas, scoreboard, margin, uiScale)
                drawLogoLayer(canvas, margin, uiScale)
                drawSponsorsLayer(canvas, margin, uiScale)
                drawWidgetsLayer(canvas, data)

                val temp = frontBitmap
                frontBitmap = backBitmap
                backBitmap = temp
                outputBitmap
            }

            // Track what we rendered to avoid pushing identical bitmaps
            val renderedData = currentData.get()
            lastRenderedData.set(renderedData)
            lastRenderedBrandingKey.set(buildBrandingFingerprint(renderedData))

            onBitmapReady?.invoke(output)
        } catch (oom: OutOfMemoryError) {
            Log.e(TAG, "Overlay render OOM - clearing cached bitmaps", oom)
            // Fix #1: Report OOM to Crashlytics as non-fatal so we see it in dashboard
            runCatching {
                FirebaseCrashlytics.getInstance().apply {
                    setCustomKey("oom_context", "overlay_render_frame")
                    setCustomKey("output_size", "${currentOutputSize.get().width}x${currentOutputSize.get().height}")
                    recordException(oom)
                }
            }
            synchronized(bitmapLock) {
                clearBitmapsLocked(clearBranding = true)
            }
        } catch (e: Exception) {
            Log.e(TAG, "Render frame error (non-fatal)", e)
        }

        if (isRunning.get() && currentData.get().showClock) {
            scheduleRender(delayMs = CLOCK_RENDER_INTERVAL_MS)
        }
    }

    private fun obtainOutputBitmapLocked(): Bitmap? {
        val size = currentOutputSize.get()
        val bitmap = backBitmap?.takeIf {
            !it.isRecycled && it.width == size.width && it.height == size.height
        } ?: run {
            recycleBitmap(backBitmap)
            createBitmapSafely(size.width, size.height)
        }
        backBitmap = bitmap
        return bitmap
    }

    private fun obtainScoreboardBitmapLocked(): Bitmap? {
        val bitmap = scoreboardBitmap?.takeIf {
            !it.isRecycled && it.width == SCOREBOARD_WIDTH && it.height == SCOREBOARD_HEIGHT
        } ?: createBitmapSafely(SCOREBOARD_WIDTH, SCOREBOARD_HEIGHT)
        scoreboardBitmap = bitmap
        return bitmap
    }

    private fun drawScoreboardLayer(canvas: Canvas, bitmap: Bitmap, margin: Float, uiScale: Float) {
        val displayScale = uiScale * SCOREBOARD_DISPLAY_SCALE
        val dst = RectF(
            margin,
            margin,
            margin + bitmap.width * displayScale,
            margin + bitmap.height * displayScale,
        )
        canvas.drawBitmap(bitmap, null, dst, imagePaint)
    }

    private fun drawLogoLayer(canvas: Canvas, margin: Float, uiScale: Float) {
        val bitmap = logoBitmap?.takeIf { !it.isRecycled } ?: return
        val boxSize = 68f * uiScale
        val box = RectF(
            canvas.width - margin - boxSize,
            margin,
            canvas.width - margin,
            margin + boxSize,
        )
        canvas.drawRoundRect(box, 10f * uiScale, 10f * uiScale, logoBgPaint)

        val innerPad = 8f * uiScale
        val dst = fitCenterRect(
            bitmap.width,
            bitmap.height,
            box.left + innerPad,
            box.top + innerPad,
            box.right - innerPad,
            box.bottom - innerPad,
        )
        canvas.drawBitmap(bitmap, null, dst, imagePaint)
    }

    private fun drawSponsorsLayer(canvas: Canvas, margin: Float, uiScale: Float) {
        val bitmap = sponsorBarBitmap?.takeIf { !it.isRecycled } ?: return
        val baseHeight = 56f * uiScale
        val scale = baseHeight / bitmap.height.toFloat()
        val width = bitmap.width * scale
        val dst = RectF(
            canvas.width - margin - width,
            canvas.height - margin - baseHeight,
            canvas.width - margin,
            canvas.height - margin,
        )
        canvas.drawBitmap(bitmap, null, dst, imagePaint)
    }

    /* ===================== Server-driven overlay widgets ===================== */

    /**
     * Nạp ảnh cho widget type "image" (pipeline TÁCH RIÊNG khỏi branding —
     * không đụng branding state machine / BrandingLoadState).
     * Mọi lỗi chỉ làm widget đó không hiển thị, stream không bị ảnh hưởng.
     */
    private fun requestWidgetAssets(data: OverlayData) {
        try {
            val urls = data.widgets.asSequence()
                .filter { it.type == "image" }
                .mapNotNull { it.url?.trim()?.takeIf(String::isNotEmpty) }
                .distinct()
                .take(MAX_OVERLAY_WIDGETS)
                .toList()
            val key = urls.joinToString("|")
            synchronized(bitmapLock) {
                if (key == cachedWidgetKey) {
                    pendingWidgetKey = ""
                    return
                }
                val pendingFresh = pendingWidgetKey == key &&
                    System.currentTimeMillis() - pendingWidgetSinceMs < WIDGET_PENDING_RETRY_MS
                if (pendingFresh) return
                pendingWidgetKey = key
                pendingWidgetSinceMs = System.currentTimeMillis()
            }
            runCatching {
                brandingHandler.post { loadWidgetImages(urls, key) }
            }.onFailure {
                Log.e(TAG, "Failed to queue widget image load", it)
                synchronized(bitmapLock) { if (pendingWidgetKey == key) pendingWidgetKey = "" }
            }
        } catch (e: Exception) {
            Log.e(TAG, "requestWidgetAssets failed (non-fatal)", e)
        }
    }

    private fun loadWidgetImages(urls: List<String>, key: String) {
        if (isReleased.get()) return
        val newlyDownloaded = mutableListOf<Bitmap>()
        try {
            val reusable = synchronized(bitmapLock) { HashMap(widgetBitmaps) }
            val loaded = HashMap<String, Bitmap>()
            for (url in urls) {
                val stale = synchronized(bitmapLock) { pendingWidgetKey != key }
                if (stale) break
                val existing = reusable[url]?.takeIf { !it.isRecycled }
                if (existing != null) {
                    loaded[url] = existing
                    continue
                }
                val bitmap = downloadBitmap(url, WIDGET_IMAGE_MAX_PX) ?: continue
                newlyDownloaded.add(bitmap)
                loaded[url] = bitmap
            }
            synchronized(bitmapLock) {
                if (pendingWidgetKey != key) {
                    newlyDownloaded.forEach { recycleBitmap(it) }
                    return
                }
                val keep = HashSet<Bitmap>(loaded.values)
                widgetBitmaps.values.forEach { old ->
                    if (old !in keep) recycleBitmap(old)
                }
                widgetBitmaps.clear()
                widgetBitmaps.putAll(loaded)
                cachedWidgetKey = key
                pendingWidgetKey = ""
            }
            scheduleRender()
        } catch (oom: OutOfMemoryError) {
            Log.e(TAG, "Widget image load OOM - skipping widgets", oom)
            newlyDownloaded.forEach { runCatching { recycleBitmap(it) } }
            synchronized(bitmapLock) { if (pendingWidgetKey == key) pendingWidgetKey = "" }
        } catch (e: Exception) {
            Log.e(TAG, "loadWidgetImages failed (non-fatal)", e)
            synchronized(bitmapLock) { if (pendingWidgetKey == key) pendingWidgetKey = "" }
        }
    }

    /** Vẽ các widget server-driven. Được gọi bên trong renderFrame (đã có try/catch + bitmapLock). */
    private fun drawWidgetsLayer(canvas: Canvas, data: OverlayData) {
        val widgets = data.widgets
        if (widgets.isEmpty()) return
        val cw = canvas.width.toFloat()
        val ch = canvas.height.toFloat()
        if (cw <= 0f || ch <= 0f) return
        var drawn = 0
        for (widget in widgets) {
            if (drawn >= MAX_OVERLAY_WIDGETS) break
            val ok = runCatching { drawSingleWidget(canvas, widget, data, cw, ch) }
                .onFailure { Log.e(TAG, "Widget '${widget.id}' draw failed (skipped)", it) }
                .getOrDefault(false)
            if (ok) drawn++
        }
    }

    private fun drawSingleWidget(
        canvas: Canvas,
        widget: com.pkt.live.data.model.OverlayWidgetData,
        data: OverlayData,
        cw: Float,
        ch: Float,
    ): Boolean {
        val alpha = (widget.opacity.coerceIn(0f, 1f) * 255f).toInt()
        if (alpha <= 0) return false
        when (widget.type) {
            "image" -> {
                val url = widget.url?.trim().orEmpty()
                if (url.isEmpty()) return false
                val bitmap = widgetBitmaps[url]?.takeIf { !it.isRecycled } ?: return false
                if (bitmap.width <= 0 || bitmap.height <= 0) return false
                val width = widget.w.coerceIn(0.01f, 1f) * cw
                val height = width * bitmap.height / bitmap.width
                val left = widget.x.coerceIn(0f, 1f) * cw
                val top = widget.y.coerceIn(0f, 1f) * ch
                widgetImagePaint.alpha = alpha
                canvas.drawBitmap(bitmap, null, RectF(left, top, left + width, top + height), widgetImagePaint)
                return true
            }
            "text" -> {
                val raw = widget.text?.trim().orEmpty()
                if (raw.isEmpty()) return false
                val display = if (raw.length > 120) raw.substring(0, 120) else raw
                val textSize = (widget.size.coerceIn(0.01f, 0.2f) * ch).coerceIn(10f, 160f)
                widgetTextPaint.textSize = textSize
                widgetTextPaint.color = parseColorSafely(widget.color, Color.WHITE)
                widgetTextPaint.alpha = alpha
                val x = widget.x.coerceIn(0f, 1f) * cw
                val yTop = widget.y.coerceIn(0f, 1f) * ch
                val fm = widgetTextPaint.fontMetrics
                val bgColor = parseColorSafely(widget.bg, 0)
                if (bgColor != 0) {
                    val pad = textSize * 0.35f
                    widgetBgPaint.color = bgColor
                    val textWidth = widgetTextPaint.measureText(display)
                    canvas.drawRoundRect(
                        RectF(
                            x - pad,
                            yTop - pad * 0.6f,
                            x + textWidth + pad,
                            yTop + (fm.bottom - fm.top) + pad * 0.6f,
                        ),
                        textSize * 0.25f,
                        textSize * 0.25f,
                        widgetBgPaint,
                    )
                }
                canvas.drawText(display, x, yTop - fm.top, widgetTextPaint)
                return true
            }
            "stats" -> return drawStatsWidget(canvas, widget, data, cw, ch, alpha)
            else -> return false // type lạ (server mới hơn app) — bỏ qua an toàn
        }
    }

    /** Bảng set-score native: tên đội + điểm từng set + điểm hiện tại (data đã có sẵn trong OverlayData). */
    private fun drawStatsWidget(
        canvas: Canvas,
        widget: com.pkt.live.data.model.OverlayWidgetData,
        data: OverlayData,
        cw: Float,
        ch: Float,
        alpha: Int,
    ): Boolean {
        val width = (widget.w.coerceIn(0.05f, 1f) * cw).coerceAtLeast(120f)
        val left = widget.x.coerceIn(0f, 1f) * cw
        val top = widget.y.coerceIn(0f, 1f) * ch
        val sets = data.sets.take(5)
        val rowH = (width * 0.085f).coerceIn(18f, 64f)
        val pad = rowH * 0.35f
        val headerH = rowH * 0.8f
        val height = headerH + rowH * 2 + pad * 2

        // Nền
        widgetBgPaint.color = parseColorSafely(widget.bg, Color.argb(205, 15, 23, 42))
        val bgRect = RectF(left, top, left + width, top + height)
        canvas.drawRoundRect(bgRect, rowH * 0.3f, rowH * 0.3f, widgetBgPaint)

        // Chia cột: tên | các set | điểm hiện tại
        val curColW = width * 0.16f
        val setColW = if (sets.isEmpty()) 0f else ((width * 0.4f) / sets.size).coerceAtMost(width * 0.14f)
        val nameColW = width - curColW - setColW * sets.size - pad * 2
        if (nameColW <= 0f) return false

        val textPaint = widgetTextPaint
        val headerSize = headerH * 0.55f
        val rowSize = rowH * 0.52f
        val textColor = parseColorSafely(widget.color, Color.WHITE)

        fun colCenterX(setIndex: Int): Float =
            left + pad + nameColW + setColW * setIndex + setColW / 2f

        val curCenterX = left + width - pad - curColW / 2f

        // Header
        textPaint.textSize = headerSize
        textPaint.color = Color.argb(200, 255, 255, 255)
        textPaint.alpha = (alpha * 0.75f).toInt()
        textPaint.textAlign = Paint.Align.CENTER
        val headerBaseline = top + pad + headerH * 0.7f
        sets.forEachIndexed { i, set ->
            canvas.drawText("S${set.index.takeIf { it > 0 } ?: (i + 1)}", colCenterX(i), headerBaseline, textPaint)
        }
        canvas.drawText("ĐIỂM", curCenterX, headerBaseline, textPaint)

        // 2 hàng đội
        val rows = listOf(
            Triple(data.teamAName, sets.map { it.a }, data.scoreA) to (data.serveSide == "A"),
            Triple(data.teamBName, sets.map { it.b }, data.scoreB) to (data.serveSide == "B"),
        )
        rows.forEachIndexed { rowIndex, (row, serving) ->
            val (name, setScores, currentScore) = row
            val rowTop = top + pad + headerH + rowH * rowIndex
            val baseline = rowTop + rowH * 0.68f

            // Chấm giao bóng (dùng widgetBgPaint — không đụng serveDotPaint của scoreboard)
            if (serving) {
                widgetBgPaint.color = Color.parseColor("#22C55E")
                widgetBgPaint.alpha = alpha
                canvas.drawCircle(left + pad + rowSize * 0.3f, rowTop + rowH / 2f, rowSize * 0.22f, widgetBgPaint)
            }

            textPaint.textSize = rowSize
            textPaint.color = textColor
            textPaint.alpha = alpha
            textPaint.textAlign = Paint.Align.LEFT
            val nameStartX = left + pad + rowSize * 0.7f
            val display = ellipsizeText(textPaint, name.ifBlank { if (rowIndex == 0) "Đội A" else "Đội B" }, nameColW - rowSize * 0.7f)
            canvas.drawText(display, nameStartX, baseline, textPaint)

            textPaint.textAlign = Paint.Align.CENTER
            setScores.forEachIndexed { i, score ->
                textPaint.alpha = (alpha * 0.85f).toInt()
                canvas.drawText(score?.toString() ?: "–", colCenterX(i), baseline, textPaint)
            }
            textPaint.textSize = rowSize * 1.15f
            textPaint.alpha = alpha
            canvas.drawText(currentScore.toString(), curCenterX, baseline, textPaint)
        }
        // Trả paint dùng chung về mặc định
        textPaint.textAlign = Paint.Align.LEFT
        return true
    }

    private fun ellipsizeText(paint: Paint, text: String, maxWidth: Float): String {
        if (maxWidth <= 0f) return ""
        if (paint.measureText(text) <= maxWidth) return text
        var end = text.length
        while (end > 1 && paint.measureText(text.substring(0, end) + "…") > maxWidth) end--
        return text.substring(0, end) + "…"
    }

    /** Parse màu an toàn; hỗ trợ cả #RRGGBBAA (web) lẫn #AARRGGBB (Android). Lỗi → fallback. */
    private fun parseColorSafely(value: String?, fallback: Int): Int {
        val v = value?.trim().orEmpty()
        if (v.isEmpty()) return fallback
        return runCatching {
            if (v.startsWith("#") && v.length == 9) {
                // Quy ước web #RRGGBBAA → Android #AARRGGBB
                Color.parseColor("#" + v.substring(7, 9) + v.substring(1, 7))
            } else {
                Color.parseColor(v)
            }
        }.getOrDefault(fallback)
    }

    private fun requestBrandingAssets(data: OverlayData) {
        val desiredLogoUrl = data.webLogoUrl?.takeIf { it.isNotBlank() }
            ?: data.tournamentLogoUrl?.takeIf { it.isNotBlank() }
            ?: ""
        val sponsorUrls = data.sponsorLogos.map { it.trim() }.filter { it.isNotBlank() }.distinct().take(MAX_SPONSORS)
        val sponsorKey = sponsorUrls.joinToString("|")
        val requestKey = "$desiredLogoUrl||$sponsorKey"
        val logoRequested = desiredLogoUrl.isNotBlank()
        val sponsorsRequested = sponsorUrls.size

        synchronized(bitmapLock) {
            if (requestKey == pendingBrandingKey && desiredLogoUrl == cachedLogoUrl && sponsorKey == cachedSponsorKey) {
                _brandingLoadState.value =
                    _brandingLoadState.value.copy(
                        isLoading = false,
                        logoRequested = logoRequested,
                        logoReady = !logoRequested || (logoBitmap?.isRecycled == false),
                        sponsorsRequested = sponsorsRequested,
                        sponsorsReady = sponsorsRequested == 0 || (sponsorBarBitmap?.isRecycled == false),
                        requestKey = requestKey,
                    )
                return
            }
            pendingBrandingKey = requestKey
        }

        _brandingLoadState.value =
            BrandingLoadState(
                isLoading = logoRequested || sponsorsRequested > 0,
                logoRequested = logoRequested,
                logoReady = !logoRequested,
                sponsorsRequested = sponsorsRequested,
                sponsorsReady = sponsorsRequested == 0,
                requestKey = requestKey,
            )

        runCatching {
            brandingHandler.removeCallbacksAndMessages(null)
            brandingHandler.post {
                loadBrandingAssets(
                    desiredLogoUrl = desiredLogoUrl,
                    sponsorUrls = sponsorUrls,
                    sponsorKey = sponsorKey,
                    requestKey = requestKey,
                )
            }
        }.onFailure {
            Log.e(TAG, "Failed to queue branding load", it)
            _brandingLoadState.value =
                _brandingLoadState.value.copy(
                    isLoading = false,
                    lastFinishedAtMs = System.currentTimeMillis(),
                )
        }
    }

    private fun loadBrandingAssets(
        desiredLogoUrl: String,
        sponsorUrls: List<String>,
        sponsorKey: String,
        requestKey: String,
    ) {
        if (isReleased.get()) return

        val logoNeedsRefresh = synchronized(bitmapLock) { desiredLogoUrl != cachedLogoUrl }
        val sponsorNeedsRefresh = synchronized(bitmapLock) { sponsorKey != cachedSponsorKey }

        val sponsorBar = runBlocking {
            supervisorScope {
                val logoDeferred =
                    if (logoNeedsRefresh && desiredLogoUrl.isNotBlank()) {
                        async(brandingDispatcher) { downloadBitmap(desiredLogoUrl, 128) }
                    } else {
                        null
                    }
                val sponsorDeferreds =
                    if (sponsorNeedsRefresh) {
                        sponsorUrls.map { sponsorUrl ->
                            async(brandingDispatcher) { downloadBitmap(sponsorUrl, 128) }
                        }
                    } else {
                        emptyList()
                    }

                if (logoNeedsRefresh) {
                    val nextLogo = logoDeferred?.await()
                    synchronized(bitmapLock) {
                        if (pendingBrandingKey != requestKey) {
                            recycleBitmap(nextLogo)
                            _brandingLoadState.value =
                                _brandingLoadState.value.copy(
                                    isLoading = false,
                                    lastFinishedAtMs = System.currentTimeMillis(),
                                )
                            return@supervisorScope null
                        }
                        recycleBitmap(logoBitmap)
                        logoBitmap = nextLogo
                        cachedLogoUrl = desiredLogoUrl
                        _brandingLoadState.value =
                            _brandingLoadState.value.copy(
                                logoRequested = desiredLogoUrl.isNotBlank(),
                                logoReady = desiredLogoUrl.isBlank() || (logoBitmap?.isRecycled == false),
                            )
                    }
                    scheduleRender()
                }

                if (!sponsorNeedsRefresh) return@supervisorScope null

                val sponsorBitmaps = sponsorDeferreds.awaitAll().filterNotNull()
                val builtSponsorBar = buildSponsorBarBitmap(sponsorBitmaps)
                sponsorBitmaps.forEach { recycleBitmap(it) }
                builtSponsorBar
            }
        }

        if (sponsorNeedsRefresh) {
            synchronized(bitmapLock) {
                if (pendingBrandingKey != requestKey) {
                    recycleBitmap(sponsorBar)
                    _brandingLoadState.value =
                        _brandingLoadState.value.copy(
                            isLoading = false,
                            lastFinishedAtMs = System.currentTimeMillis(),
                        )
                    return
                }
                recycleBitmap(sponsorBarBitmap)
                sponsorBarBitmap = sponsorBar
                cachedSponsorKey = sponsorKey
                _brandingLoadState.value =
                    _brandingLoadState.value.copy(
                        sponsorsRequested = sponsorUrls.size,
                        sponsorsReady = sponsorUrls.isEmpty() || (sponsorBarBitmap?.isRecycled == false),
                    )
            }
            scheduleRender()
        }

        val logoReady = desiredLogoUrl.isBlank() || synchronized(bitmapLock) { logoBitmap?.isRecycled == false }
        val sponsorsReady = sponsorUrls.isEmpty() || synchronized(bitmapLock) { sponsorBarBitmap?.isRecycled == false }
        _brandingLoadState.value =
            _brandingLoadState.value.copy(
                isLoading = false,
                logoRequested = desiredLogoUrl.isNotBlank(),
                logoReady = logoReady,
                sponsorsRequested = sponsorUrls.size,
                sponsorsReady = sponsorsReady,
                requestKey = requestKey,
                lastFinishedAtMs = System.currentTimeMillis(),
            )
    }

    private fun downloadBitmap(url: String, maxSizePx: Int): Bitmap? {
        var conn: HttpURLConnection? = null
        return try {
            val resolvedUrl = normalizeImageUrl(url)
            conn = (URL(resolvedUrl).openConnection() as HttpURLConnection).apply {
                connectTimeout = BRANDING_CONNECT_TIMEOUT_MS
                readTimeout = BRANDING_READ_TIMEOUT_MS
                instanceFollowRedirects = true
                doInput = true
            }
            conn.connect()
            if (conn.responseCode !in 200..299) return null

            val bytes = conn.inputStream.use { input ->
                readLimitedBytes(input, MAX_BRANDING_DOWNLOAD_BYTES)
            }
            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
            val sample = calculateInSampleSize(bounds.outWidth, bounds.outHeight, maxSizePx, maxSizePx)
            val decode = BitmapFactory.Options().apply {
                inSampleSize = sample
                inPreferredConfig = Bitmap.Config.ARGB_8888
            }
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size, decode)
        } catch (oom: OutOfMemoryError) {
            Log.e(TAG, "Bitmap decode OOM for $url", oom)
            null
        } catch (_: Exception) {
            null
        } finally {
            runCatching { conn?.disconnect() }
        }
    }

    private fun readLimitedBytes(
        input: java.io.InputStream,
        maxBytes: Int,
    ): ByteArray {
        val output = ByteArrayOutputStream()
        val buffer = ByteArray(8 * 1024)
        var total = 0
        while (true) {
            val read = input.read(buffer)
            if (read <= 0) break
            total += read
            if (total > maxBytes) {
                throw IllegalStateException("Branding image too large (${total} bytes)")
            }
            output.write(buffer, 0, read)
        }
        return output.toByteArray()
    }

    private fun buildSponsorBarBitmap(bitmaps: List<Bitmap>): Bitmap? {
        if (bitmaps.isEmpty()) return null
        val slots = bitmaps.take(MAX_SPONSORS)
        val itemH = 64
        val slotW = 64
        val pad = 8
        val outW = pad + slots.size * (slotW + pad)
        val outH = itemH + pad * 2
        val out = createBitmapSafely(outW, outH) ?: return null
        val canvas = Canvas(out)
        canvas.drawColor(Color.TRANSPARENT, PorterDuff.Mode.CLEAR)

        var x = pad
        for (bitmap in slots) {
            val dst = Rect(x, pad, x + slotW, pad + itemH)
            canvas.drawBitmap(bitmap, null, dst, imagePaint)
            x += slotW + pad
        }
        return out
    }

    private fun normalizeImageUrl(raw: String): String {
        val url = raw.trim()
        if (url.isBlank()) return url
        if (url.startsWith("//")) return "https:$url"
        if (url.startsWith("http://", ignoreCase = true) || url.startsWith("https://", ignoreCase = true)) {
            return url
        }

        val origin = BuildConfig.BASE_URL.substringBefore("/api/").trimEnd('/')
        return if (url.startsWith('/')) "$origin$url" else "$origin/${url.trimStart('/')}"
    }

    private fun calculateInSampleSize(srcW: Int, srcH: Int, reqW: Int, reqH: Int): Int {
        var inSampleSize = 1
        var w = srcW
        var h = srcH
        while (w / 2 >= reqW && h / 2 >= reqH) {
            inSampleSize *= 2
            w /= 2
            h /= 2
        }
        return inSampleSize.coerceAtLeast(1)
    }

    private fun fitCenterRect(srcW: Int, srcH: Int, left: Float, top: Float, right: Float, bottom: Float): RectF {
        val boxW = (right - left).coerceAtLeast(1f)
        val boxH = (bottom - top).coerceAtLeast(1f)
        val scale = minOf(boxW / srcW.toFloat(), boxH / srcH.toFloat())
        val drawW = srcW * scale
        val drawH = srcH * scale
        val dx = left + (boxW - drawW) / 2f
        val dy = top + (boxH - drawH) / 2f
        return RectF(dx, dy, dx + drawW, dy + drawH)
    }

    private fun recycleBitmap(bitmap: Bitmap?) {
        if (bitmap != null && !bitmap.isRecycled) {
            runCatching { bitmap.recycle() }
        }
    }

    private fun clearBitmapsLocked(clearBranding: Boolean) {
        recycleBitmap(frontBitmap)
        recycleBitmap(backBitmap)
        recycleBitmap(scoreboardBitmap)
        frontBitmap = null
        backBitmap = null
        scoreboardBitmap = null
        if (clearBranding) {
            recycleBitmap(logoBitmap)
            recycleBitmap(sponsorBarBitmap)
            logoBitmap = null
            sponsorBarBitmap = null
            cachedLogoUrl = ""
            cachedSponsorKey = ""
            pendingBrandingKey = ""
            _brandingLoadState.value = BrandingLoadState()
            widgetBitmaps.values.forEach { recycleBitmap(it) }
            widgetBitmaps.clear()
            cachedWidgetKey = ""
            pendingWidgetKey = ""
        }
    }

    private fun createBitmapSafely(width: Int, height: Int): Bitmap? {
        // Fix #1: Cap bitmap size to prevent OOM on low-RAM devices
        val safeW = width.coerceIn(1, MAX_BITMAP_DIMENSION)
        val safeH = height.coerceIn(1, MAX_BITMAP_DIMENSION)
        return try {
            Bitmap.createBitmap(safeW, safeH, Bitmap.Config.ARGB_8888)
        } catch (oom: OutOfMemoryError) {
            Log.e(TAG, "Bitmap allocation OOM ${safeW}x$safeH", oom)
            runCatching {
                FirebaseCrashlytics.getInstance().apply {
                    setCustomKey("oom_context", "createBitmapSafely")
                    setCustomKey("requested_size", "${width}x$height")
                    setCustomKey("capped_size", "${safeW}x$safeH")
                    recordException(oom)
                }
            }
            null
        }
    }

    private fun drawV2Scoreboard(canvas: Canvas, data: OverlayData) {
        val w = canvas.width.toFloat()
        val cornerR = 8f

        val colorWhite = Color.WHITE
        val colorBlack = Color.BLACK
        val colorGreenScore = Color.parseColor("#41935D")
        val colorDivider = Color.argb(77, 255, 255, 255)

        val topBarH = 32f
        val rowH = 36f
        val midH = rowH * 2 + 12f
        val scoreColW = 70f
        val hasBottom = data.stageName.isNotBlank()
        val bottomBarH = if (hasBottom) 32f else 0f
        val gap = 2f
        val startY = 4f

        fillPaint.color = colorWhite
        val topRect = RectF(0f, startY, w, startY + topBarH)
        canvas.drawRoundRect(topRect, cornerR, cornerR, fillPaint)
        canvas.drawRect(0f, startY + topBarH - cornerR, w, startY + topBarH, fillPaint)

        val topTitle = data.tournamentName.ifBlank { "GIẢI PICKLETOUR BETA" }.uppercase()
        topBarPaint.color = colorBlack
        val topTextY = startY + topBarH / 2f + topBarPaint.textSize / 3f
        canvas.drawText(truncateText(topTitle, topBarPaint, w - 28f), w / 2f, topTextY, topBarPaint)

        val midTop = startY + topBarH + gap
        fillPaint.color = colorBlack
        canvas.drawRect(0f, midTop, w, midTop + midH, fillPaint)

        val nameAreaW = w - scoreColW
        val rowAY = midTop + 8f
        drawV2TeamRow(
            canvas = canvas,
            y = rowAY,
            h = rowH,
            name = data.teamAName,
            seed = data.seedA,
            isServing = data.serveSide == "A",
            serveCount = data.serveCount,
            nameAreaW = nameAreaW,
            overlayNameStyle = data.overlayNameStyle,
        )

        val rowBY = rowAY + rowH + 4f
        drawV2TeamRow(
            canvas = canvas,
            y = rowBY,
            h = rowH,
            name = data.teamBName,
            seed = data.seedB,
            isServing = data.serveSide == "B",
            serveCount = data.serveCount,
            nameAreaW = nameAreaW,
            overlayNameStyle = data.overlayNameStyle,
        )

        val scoreLeft = w - scoreColW
        fillPaint.color = colorGreenScore
        canvas.drawRect(scoreLeft, midTop, w, midTop + midH, fillPaint)

        val scoreAY = rowAY + rowH / 2f + scorePaint.textSize / 3f
        canvas.drawText(data.scoreA.toString(), scoreLeft + scoreColW / 2f, scoreAY, scorePaint)

        fillPaint.color = colorDivider
        val dividerY = midTop + midH / 2f
        canvas.drawRect(scoreLeft + 4f, dividerY - 0.5f, w - 4f, dividerY + 0.5f, fillPaint)

        val scoreBY = rowBY + rowH / 2f + scorePaint.textSize / 3f
        canvas.drawText(data.scoreB.toString(), scoreLeft + scoreColW / 2f, scoreBY, scorePaint)

        if (hasBottom) {
            val bottomTop = midTop + midH + gap
            fillPaint.color = colorWhite
            val bottomRect = RectF(0f, bottomTop, w, bottomTop + bottomBarH)
            canvas.drawRoundRect(bottomRect, cornerR, cornerR, fillPaint)
            canvas.drawRect(0f, bottomTop, w, bottomTop + cornerR, fillPaint)

            topBarPaint.color = colorBlack
            val bottomTextY = bottomTop + bottomBarH / 2f + topBarPaint.textSize / 3f
            canvas.drawText(
                truncateText(data.stageName.uppercase(), topBarPaint, w - 28f),
                w / 2f,
                bottomTextY,
                topBarPaint,
            )
        }
    }

    private fun drawV2TeamRow(
        canvas: Canvas,
        y: Float,
        h: Float,
        name: String,
        seed: Int?,
        isServing: Boolean,
        serveCount: Int,
        nameAreaW: Float,
        overlayNameStyle: String,
    ) {
        var x = 14f

        if (seed != null && seed > 0) {
            canvas.drawText(seed.toString(), x, y + h / 2f + seedPaint.textSize / 3f, seedPaint)
            x += seedPaint.measureText(seed.toString()) + 6f
        }

        val dotAreaW = 36f
        val nameMaxW = nameAreaW - x - dotAreaW - 10f
        val baseline = y + h / 2f + namePaint.textSize / 3f
        drawFittedTeamName(
            canvas = canvas,
            rawName = name,
            style = overlayNameStyle,
            x = x,
            baseline = baseline,
            maxWidth = nameMaxW,
        )

        val dotX = nameAreaW - dotAreaW
        val dotCenterY = y + h / 2f
        if (isServing) {
            canvas.drawCircle(dotX, dotCenterY, 5f, serveDotPaint)
            if (serveCount >= 2) {
                canvas.drawCircle(dotX + 14f, dotCenterY, 5f, serveDotPaint)
            }
        }
    }

    private fun drawBreakCard(canvas: Canvas, data: OverlayData) {
        val w = canvas.width.toFloat()
        val h = canvas.height.toFloat()
        val cornerR = 8f

        fillPaint.color = Color.parseColor("#E61A1A1A")
        canvas.drawRoundRect(RectF(0f, 0f, w, h), cornerR, cornerR, fillPaint)

        var y = 24f
        if (data.tournamentName.isNotBlank()) {
            canvas.drawText(data.tournamentName, 16f, y, subPaint)
            y += 20f
        }
        if (data.courtName.isNotBlank()) {
            canvas.drawText("Sân: ${data.courtName}", 16f, y, subPaint)
            y += 20f
        }

        y += 4f
        val titlePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.WHITE
            textSize = 30f
            typeface = Typeface.DEFAULT_BOLD
        }
        canvas.drawText("ĐANG TẠM NGHỈ", 16f, y, titlePaint)
        y += 24f
        canvas.drawText("Chờ trọng tài bắt đầu game tiếp theo...", 16f, y, subPaint)
        y += 20f

        if (data.breakNote.isNotBlank()) {
            canvas.drawText(data.breakNote, 16f, y, subPaint)
            y += 20f
        }

        y += 4f
        val teamPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.WHITE
            textSize = 20f
        }
        canvas.drawText("${data.teamAName} vs ${data.teamBName}", 16f, y, teamPaint)
    }

    private fun truncateText(text: String, paint: Paint, maxWidth: Float): String {
        if (paint.measureText(text) <= maxWidth) return text
        var end = text.length
        while (end > 0 && paint.measureText(text, 0, end) + paint.measureText("...") > maxWidth) {
            end--
        }
        return if (end > 0) "${text.substring(0, end)}..." else text
    }

    private fun drawFittedTeamName(
        canvas: Canvas,
        rawName: String,
        style: String,
        x: Float,
        baseline: Float,
        maxWidth: Float,
    ) {
        val originalSize = namePaint.textSize
        val fit = chooseFittedTeamName(rawName, style, maxWidth)
        namePaint.textSize = fit.textSize
        val measured = namePaint.measureText(fit.text)
        val scaleX = if (measured > maxWidth && measured > 0f) {
            (maxWidth / measured).coerceAtMost(1f)
        } else {
            1f
        }

        if (scaleX < 1f) {
            canvas.save()
            canvas.scale(scaleX, 1f, x, baseline)
            canvas.drawText(fit.text, x, baseline, namePaint)
            canvas.restore()
        } else {
            canvas.drawText(fit.text, x, baseline, namePaint)
        }
        namePaint.textSize = originalSize
    }

    private fun chooseFittedTeamName(
        rawName: String,
        style: String,
        maxWidth: Float,
    ): FittedTeamName {
        val normalizedStyle = normalizeOverlayNameStyle(style)
        val candidates = overlayTeamNameCandidates(rawName, normalizedStyle)
        val primarySizes = listOf(28f, 26f, 24f, 22f, 20f, 18f)
        val compactSizes = listOf(26f, 24f, 22f, 20f, 18f, 16f, 14f)
        val originalSize = namePaint.textSize

        candidates.forEachIndexed { index, candidate ->
            val sizes =
                if (normalizedStyle == "2" || index == 0) {
                    primarySizes
                } else {
                    compactSizes
                }
            for (size in sizes) {
                namePaint.textSize = size
                if (namePaint.measureText(candidate) <= maxWidth) {
                    namePaint.textSize = originalSize
                    return FittedTeamName(candidate, size)
                }
            }
        }

        val fallbackText = candidates.lastOrNull().orEmpty().ifBlank { rawName.trim() }
        namePaint.textSize = originalSize
        return FittedTeamName(fallbackText, 14f)
    }

    private data class FittedTeamName(
        val text: String,
        val textSize: Float,
    )
}

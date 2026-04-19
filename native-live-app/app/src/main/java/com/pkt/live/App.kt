package com.pkt.live

import android.app.Application
import android.content.ComponentCallbacks2
import android.os.Looper
import android.util.Log
import coil.Coil
import com.google.firebase.crashlytics.FirebaseCrashlytics
import coil.ImageLoader
import coil.ImageLoaderFactory
import coil.disk.DiskCache
import coil.memory.MemoryCache
import coil.request.CachePolicy
import com.pkt.live.di.appModule
import com.pkt.live.data.api.AuthInterceptor
import com.pkt.live.data.auth.TokenStore
import com.pkt.live.data.observer.ObserverCrashMarkerStore
import com.pkt.live.data.repository.LiveRepository
import com.pkt.live.streaming.StreamRuntimeRegistry
import org.koin.android.ext.koin.androidContext
import org.koin.android.ext.koin.androidLogger
import org.koin.core.context.startKoin
import org.koin.core.logger.Level
import org.koin.java.KoinJavaComponent

class App : Application(), ImageLoaderFactory {

    companion object {
        private const val TAG = "PickletourLive"
    }

    override fun onCreate() {
        super.onCreate()
        installTransportCrashGuard()

        // Firebase Crashlytics — Fix #9: wrapped in runCatching for safety
        runCatching {
            FirebaseCrashlytics.getInstance().apply {
                setCrashlyticsCollectionEnabled(true)
                setCustomKey("app_version", BuildConfig.VERSION_NAME)
                setCustomKey("build_type", BuildConfig.BUILD_TYPE)
            }
        }.onFailure {
            Log.e(TAG, "Crashlytics init failed", it)
        }

        startKoin {
            androidLogger(Level.ERROR)
            androidContext(this@App)
            modules(appModule)
        }
        try {
            val koin = org.koin.java.KoinJavaComponent.getKoin()
            val token = koin.get<TokenStore>().getSessionOrNull()?.accessToken
            koin.get<AuthInterceptor>().token = token
            if (!token.isNullOrBlank()) {
                koin.get<LiveRepository>().connectSocketSession(token)
            }
        } catch (e: Exception) {
            // Fix #8: Log Koin init errors to Crashlytics instead of silently swallowing
            Log.e(TAG, "Early init failed", e)
            runCatching { FirebaseCrashlytics.getInstance().recordException(e) }
        }
    }

    /**
     * Configure Coil with strict memory/disk cache limits.
     * Prevents OOM from loading large sponsor/tournament logos.
     *
     * - Memory cache: 15% of available RAM (vs default 25%)
     * - Disk cache: 50MB max
     * - Crossfade for smooth loading
     * - Hardware bitmaps enabled (uses less RAM on API 26+)
     */
    override fun newImageLoader(): ImageLoader {
        return ImageLoader.Builder(this)
            .memoryCache {
                MemoryCache.Builder(this)
                    .maxSizePercent(0.15) // 15% of available RAM (default is 25%)
                    .build()
            }
            .diskCache {
                DiskCache.Builder()
                    .directory(cacheDir.resolve("coil_cache"))
                    .maxSizeBytes(50L * 1024 * 1024) // 50MB
                    .build()
            }
            .memoryCachePolicy(CachePolicy.ENABLED)
            .diskCachePolicy(CachePolicy.ENABLED)
            .crossfade(true)
            .allowHardware(true) // Hardware bitmaps use less RAM on API 26+
            .build()
    }

    /**
     * Anti-crash: System is running low on memory.
     * Reduce streaming quality AND clear image cache to free RAM.
     */
    override fun onTrimMemory(level: Int) {
        super.onTrimMemory(level)
        if (level >= ComponentCallbacks2.TRIM_MEMORY_RUNNING_LOW) {
            Log.w(TAG, "System memory pressure: level=$level — reducing quality + clearing image cache")

            // Clear Coil memory cache to free RAM immediately
            try {
                Coil.imageLoader(this).memoryCache?.clear()
                Log.d(TAG, "Image memory cache cleared")
            } catch (e: Exception) {
                Log.e(TAG, "Failed to clear image cache", e)
            }

            // Reduce stream quality
            try {
                val runtimeRegistry = org.koin.java.KoinJavaComponent
                    .getKoin().getOrNull<StreamRuntimeRegistry>()
                runtimeRegistry?.activeOverlayRenderer()?.trimMemory()
                runtimeRegistry?.activeStreamManager()?.onMemoryPressure(level)
            } catch (e: Exception) {
                Log.e(TAG, "Failed to notify stream manager of memory pressure", e)
            }
        }
    }
    private fun installTransportCrashGuard() {
        val previousHandler = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, throwable ->
            if (shouldSoftHandleTransportCrash(thread, throwable)) {
                Log.e(TAG, "Soft-handled RootEncoder transport crash on ${thread.name}", throwable)
                runCatching {
                    FirebaseCrashlytics.getInstance().apply {
                        log(
                            "SOFT_RTMP_TRANSPORT_CRASH thread=${thread.name} message=${throwable.message.orEmpty().take(160)}"
                        )
                        recordException(
                            IllegalStateException("Soft-handled RootEncoder transport crash", throwable)
                        )
                    }
                }
                runCatching {
                    KoinJavaComponent.getKoin()
                        .getOrNull<StreamRuntimeRegistry>()
                        ?.activeStreamManager()
                        ?.handleFatalTransportException(throwable, thread.name)
                }.onFailure {
                    Log.e(TAG, "Failed to notify stream manager of soft transport crash", it)
                }
                return@setDefaultUncaughtExceptionHandler
            }
            ObserverCrashMarkerStore.recordUnhandledCrash(
                context = applicationContext,
                threadName = thread.name,
                throwable = throwable,
            )
            previousHandler?.uncaughtException(thread, throwable)
        }
    }

    private fun shouldSoftHandleTransportCrash(
        thread: Thread,
        throwable: Throwable,
    ): Boolean {
        if (thread === Looper.getMainLooper().thread) return false
        val streamManagerActive = runCatching {
            KoinJavaComponent.getKoin()
                .getOrNull<StreamRuntimeRegistry>()
                ?.activeStreamManager() != null
        }.getOrDefault(false)
        if (!streamManagerActive) return false

        val causes = generateSequence(throwable) { it.cause }.toList()
        val brokenPipe = causes.any { cause ->
            cause.message?.contains("Broken pipe", ignoreCase = true) == true
        }
        if (!brokenPipe) return false

        return causes.any { cause ->
            cause.stackTrace.any { frame -> frame.className.startsWith("io.ktor.") }
        }
    }
}

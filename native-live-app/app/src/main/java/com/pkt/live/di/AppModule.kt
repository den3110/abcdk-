package com.pkt.live.di

import com.google.gson.Gson
import com.google.gson.GsonBuilder
import com.pkt.live.BuildConfig
import com.pkt.live.data.api.AuthInterceptor
import com.pkt.live.data.api.RetryInterceptor
import com.pkt.live.data.api.PickleTourApi
import com.pkt.live.data.auth.TokenStore
import com.pkt.live.data.observer.ObserverTelemetryClient
import com.pkt.live.data.recording.MatchRecordingCoordinator
import com.pkt.live.data.repository.LiveRepository
import com.pkt.live.data.socket.CourtPresenceSocketManager
import com.pkt.live.data.socket.CourtRuntimeSocketManager
import com.pkt.live.data.socket.MatchSocketManager
import com.pkt.live.streaming.OverlayBitmapRenderer
import com.pkt.live.streaming.RtmpStreamManager
import com.pkt.live.streaming.StreamRuntimeRegistry
import com.pkt.live.ui.LiveStreamViewModel
import com.pkt.live.util.NetworkMonitor
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import org.koin.android.ext.koin.androidContext
import org.koin.core.module.dsl.viewModel
import org.koin.dsl.module
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import java.util.concurrent.TimeUnit

val appModule = module {

    // Gson
    single<Gson> {
        GsonBuilder()
            .setLenient()
            .create()
    }

    // Auth interceptor (singleton — token set once)
    single { AuthInterceptor() }

    single {
        TokenStore(context = androidContext())
    }

    // OkHttp client
    single {
        OkHttpClient.Builder()
            .addInterceptor(get<AuthInterceptor>())
            .addInterceptor(RetryInterceptor(maxRetries = 3, initialDelayMs = 1000))
            .apply {
                if (BuildConfig.DEBUG) {
                    addInterceptor(HttpLoggingInterceptor().apply {
                        level = HttpLoggingInterceptor.Level.BODY
                    })
                }
            }
            .connectTimeout(30, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .writeTimeout(30, TimeUnit.SECONDS)
            .retryOnConnectionFailure(true)
            .build()
    }

    // Retrofit
    single {
        Retrofit.Builder()
            .baseUrl(BuildConfig.BASE_URL)
            .client(get())
            .addConverterFactory(GsonConverterFactory.create(get()))
            .build()
    }

    // API interface
    single<PickleTourApi> {
        get<Retrofit>().create(PickleTourApi::class.java)
    }

    single {
        val observerOkHttpClient =
            get<OkHttpClient>()
                .newBuilder()
                .apply {
                    interceptors().clear()
                    networkInterceptors().clear()
                }
                .connectTimeout(4, TimeUnit.SECONDS)
                .readTimeout(4, TimeUnit.SECONDS)
                .writeTimeout(4, TimeUnit.SECONDS)
                .retryOnConnectionFailure(false)
                .build()
        ObserverTelemetryClient(
            appContext = androidContext(),
            okHttpClient = observerOkHttpClient,
            gson = get(),
            authInterceptor = get(),
        )
    }

    // Socket manager
    single {
        MatchSocketManager(
            socketUrl = BuildConfig.SOCKET_URL,
            gson = get(),
        )
    }

    single {
        CourtPresenceSocketManager(
            socketUrl = BuildConfig.SOCKET_URL,
            gson = get(),
        )
    }

    single {
        CourtRuntimeSocketManager(
            socketUrl = BuildConfig.SOCKET_URL,
            gson = get(),
        )
    }

    // Repository
    single {
        LiveRepository(
            api = get(),
            socketManager = get(),
            courtPresenceSocketManager = get(),
            courtRuntimeSocketManager = get(),
            gson = get(),
        )
    }

    single {
        NetworkMonitor(context = androidContext())
    }

    single {
        MatchRecordingCoordinator(
            appContext = androidContext(),
            repository = get(),
            okHttpClient = get(),
            gson = get(),
        )
    }

    single {
        StreamRuntimeRegistry()
    }

    // Stream manager (scoped to context for camera)
    factory {
        RtmpStreamManager(
            context = androidContext(),
            runtimeRegistry = get(),
        )
    }

    // Overlay bitmap renderer (for RTMP stream output)
    factory {
        OverlayBitmapRenderer(
            context = androidContext(),
            runtimeRegistry = get(),
        )
    }

    // ViewModel
    viewModel {
        LiveStreamViewModel(
            repository = get(),
            streamManager = get(),
            authInterceptor = get(),
            tokenStore = get(),
            overlayRenderer = get(),
            networkMonitor = get(),
            appContext = androidContext(),
            recordingCoordinator = get(),
            observerTelemetryClient = get(),
        )
    }
}

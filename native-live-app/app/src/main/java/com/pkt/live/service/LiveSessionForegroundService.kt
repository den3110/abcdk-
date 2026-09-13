package com.pkt.live.service

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import com.pkt.live.R
import com.pkt.live.ui.LiveStreamActivity

/**
 * Foreground service giữ quyền camera + micro + mạng cho phiên live/ghi hình khi màn hình tắt,
 * có cuộc gọi đến hoặc operator lỡ bấm Home. Không có nó, Android 11+ thu hồi camera ngay khi app
 * rời foreground và Doze bóp mạng → live rớt giữa trận khi treo máy 10 tiếng trên tripod.
 *
 * Service KHÔNG giữ logic stream — chỉ là "giấy phép" hệ thống + partial wake lock. Activity bật
 * khi có ý định phiên (live / ghi hình / đang armed chờ trận) và tắt khi phiên kết thúc.
 */
class LiveSessionForegroundService : Service() {

    companion object {
        private const val TAG = "LiveFgService"
        private const val CHANNEL_ID = "live_session"
        private const val NOTIFICATION_ID = 4101
        private const val ACTION_START = "com.pkt.live.action.FGS_START"
        private const val ACTION_UPDATE = "com.pkt.live.action.FGS_UPDATE"
        private const val ACTION_STOP = "com.pkt.live.action.FGS_STOP"
        private const val EXTRA_TEXT = "text"
        private const val WAKE_LOCK_TAG = "pkt:live-session"
        private const val WAKE_LOCK_TIMEOUT_MS = 14L * 60 * 60 * 1000 // 14h: dư cho 1 ngày giải

        @Volatile
        var isRunning: Boolean = false
            private set

        /** Phải gọi khi app đang foreground (Android cấm start FGS camera/mic từ background). */
        fun start(context: Context, text: String? = null) {
            val intent = Intent(context, LiveSessionForegroundService::class.java)
                .setAction(ACTION_START)
                .putExtra(EXTRA_TEXT, text)
            runCatching { ContextCompat.startForegroundService(context, intent) }
                .onFailure { Log.e(TAG, "startForegroundService failed", it) }
        }

        fun update(context: Context, text: String?) {
            if (!isRunning) return
            val intent = Intent(context, LiveSessionForegroundService::class.java)
                .setAction(ACTION_UPDATE)
                .putExtra(EXTRA_TEXT, text)
            runCatching { context.startService(intent) }
                .onFailure { Log.w(TAG, "update failed", it) }
        }

        fun stop(context: Context) {
            if (!isRunning) return
            val intent = Intent(context, LiveSessionForegroundService::class.java).setAction(ACTION_STOP)
            runCatching { context.startService(intent) }
                .onFailure {
                    Log.w(TAG, "stop via startService failed, fallback stopService", it)
                    runCatching { context.stopService(intent) }
                }
        }
    }

    private var wakeLock: PowerManager.WakeLock? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        ensureChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> {
                stopSelfSafely()
                return START_NOT_STICKY
            }
            ACTION_UPDATE -> {
                if (isRunning) {
                    notificationManager().notify(NOTIFICATION_ID, buildNotification(intent.getStringExtra(EXTRA_TEXT)))
                }
                return START_NOT_STICKY
            }
            else -> {
                val notification = buildNotification(intent?.getStringExtra(EXTRA_TEXT))
                try {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                        ServiceCompat.startForeground(
                            this,
                            NOTIFICATION_ID,
                            notification,
                            ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA or
                                ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE,
                        )
                    } else {
                        startForeground(NOTIFICATION_ID, notification)
                    }
                    isRunning = true
                    acquireWakeLock()
                    Log.d(TAG, "Foreground service started")
                } catch (t: Throwable) {
                    // Ví dụ: gọi từ background trên Android 12+ → ForegroundServiceStartNotAllowedException.
                    // Không crash app; live vẫn chạy như trước khi có service.
                    Log.e(TAG, "startForeground failed", t)
                    stopSelfSafely()
                }
                // NOT_STICKY: process chết thì activity/stream cũng chết, service tự khởi động lại là vô nghĩa.
                return START_NOT_STICKY
            }
        }
    }

    override fun onDestroy() {
        releaseWakeLock()
        isRunning = false
        Log.d(TAG, "Foreground service destroyed")
        super.onDestroy()
    }

    private fun stopSelfSafely() {
        releaseWakeLock()
        isRunning = false
        runCatching { ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE) }
        stopSelf()
    }

    private fun acquireWakeLock() {
        if (wakeLock?.isHeld == true) return
        val pm = getSystemService(Context.POWER_SERVICE) as? PowerManager ?: return
        wakeLock = runCatching {
            pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, WAKE_LOCK_TAG).also {
                it.setReferenceCounted(false)
                it.acquire(WAKE_LOCK_TIMEOUT_MS)
            }
        }.onFailure { Log.w(TAG, "wake lock acquire failed", it) }.getOrNull()
    }

    private fun releaseWakeLock() {
        runCatching { wakeLock?.takeIf { it.isHeld }?.release() }
        wakeLock = null
    }

    private fun notificationManager(): NotificationManager =
        getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

    private fun ensureChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val channel = NotificationChannel(
            CHANNEL_ID,
            "Phiên live đang chạy",
            NotificationManager.IMPORTANCE_LOW,
        ).apply {
            description = "Giữ camera/micro và mạng khi màn hình tắt hoặc chuyển app"
            setShowBadge(false)
        }
        notificationManager().createNotificationChannel(channel)
    }

    private fun buildNotification(text: String?): Notification {
        val openIntent = Intent(this, LiveStreamActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
        }
        val pending = PendingIntent.getActivity(
            this,
            0,
            openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_live)
            .setContentTitle("PickleTour Live đang chạy")
            .setContentText(text?.takeIf { it.isNotBlank() } ?: "Đang giữ camera, micro và mạng cho phiên live")
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .setContentIntent(pending)
            .build()
    }
}

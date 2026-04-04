package com.pkt.live.ui

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.os.Bundle
import android.util.Log
import android.view.Gravity
import android.view.WindowManager
import android.widget.FrameLayout
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.compose.ui.platform.ComposeView
import androidx.core.content.ContextCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import com.pedro.library.view.OpenGlView
import com.pkt.live.R
import com.pkt.live.data.auth.TokenStore
import com.pkt.live.ui.screen.LiveScreen
import com.pkt.live.ui.theme.PickletourLiveTheme
import org.koin.android.ext.android.inject
import org.koin.androidx.viewmodel.ext.android.viewModel

/**
 * Single Activity for the live stream screen.
 * Handles: deeplink parsing, permissions, lifecycle, immersive mode.
 *
 * Anti-crash: No dynamic fragment transactions, no view add/remove at runtime.
 */
class LiveStreamActivity : AppCompatActivity() {

    companion object {
        private const val TAG = "LiveActivity"
        private const val STATE_MATCH_ID = "state_match_id"
        private const val STATE_PAGE_ID = "state_page_id"
        private const val STATE_COURT_ID = "state_court_id"
        private const val STATE_TOKEN = "state_token"
        const val EXTRA_MATCH_ID = "extra_match_id"
        const val EXTRA_PAGE_ID = "extra_page_id"
        const val EXTRA_COURT_ID = "extra_court_id"
        const val EXTRA_TOKEN = "extra_token"
    }

    private val viewModel: LiveStreamViewModel by viewModel()
    private val tokenStore: TokenStore by inject()

    private var pendingMatchId: String = ""
    private var pendingPageId: String? = null
    private var pendingCourtId: String = ""
    private var currentToken: String = ""
    private var contentReady: Boolean = false
    private var loginInFlight: Boolean = false
    private val permissionsLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { permissions ->
        val cam = permissions[Manifest.permission.CAMERA] == true
        val mic = permissions[Manifest.permission.RECORD_AUDIO] == true
        if (cam && mic) {
            initStream()
        } else {
            Log.e(TAG, "Permissions denied: camera=$cam, mic=$mic")
            viewModel.showLiveIssue("Thiếu quyền camera/micro. Hãy cấp quyền để tiếp tục live.")
        }
    }

    private val loginLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        loginInFlight = false
        val token = result.data?.getStringExtra(LoginActivity.EXTRA_TOKEN)
        if (!token.isNullOrBlank()) {
            currentToken = token
            if (pendingMatchId.isNotBlank()) {
                viewModel.init(pendingMatchId, token, pendingPageId)
            } else if (pendingCourtId.isNotBlank()) {
                viewModel.initByCourt(pendingCourtId, token, pendingPageId)
            } else {
                viewModel.showLiveIssue("Không có match/court hợp lệ để vào màn live.")
            }
        } else {
            viewModel.showLiveIssue("Không tìm thấy phiên đăng nhập. Hãy thử mở studio lại.")
        }
    }

    private val courtSetupLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        val matchId = result.data?.getStringExtra(CourtSetupActivity.EXTRA_MATCH_ID).orEmpty()
        val pageId = result.data?.getStringExtra(CourtSetupActivity.EXTRA_PAGE_ID)
        if (matchId.isNotBlank() && currentToken.isNotBlank()) {
            pendingMatchId = matchId
            pendingPageId = pageId ?: pendingPageId
            viewModel.init(matchId, currentToken, pendingPageId)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Keep screen on during livestream
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        // Immersive full screen
        WindowCompat.setDecorFitsSystemWindows(window, false)
        WindowInsetsControllerCompat(window, window.decorView).apply {
            hide(WindowInsetsCompat.Type.statusBars() or WindowInsetsCompat.Type.navigationBars())
            systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        }

        // Parse deeplink (keep this very light to avoid blocking transition)
        applyIntentPayload(savedInstanceState = savedInstanceState, sourceIntent = intent, reinitialize = false)

        setContentView(R.layout.activity_live)

        // Attach camera surface
        val openGlView = findViewById<OpenGlView>(R.id.surfaceView)
        viewModel.streamManager.attachSurface(openGlView)

        // Register stream manager as lifecycle observer (anti-crash: formal lifecycle)
        lifecycle.addObserver(viewModel.streamManager)

        // Setup Compose UI
        val composeView = findViewById<ComposeView>(R.id.composeView)
        composeView.setContent {
            PickletourLiveTheme {
                LiveScreen(viewModel = viewModel)
            }
        }
        contentReady = true
        updateLiveCanvasBounds(resources.configuration.orientation)

        // Check permissions
        checkAndRequestPermissions()

        // Defer heavy init to after UI is attached (smoother transition)
        composeView.post {
            updateLiveCanvasBounds(resources.configuration.orientation)
            routeToLiveTarget()
        }
    }

    override fun onResume() {
        super.onResume()
        viewModel.onHostResumed()
        // Preview restart is now handled by LifecycleObserver in RtmpStreamManager
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        Log.d(TAG, "onNewIntent: action=${intent.action}, data=${intent.data}")
        applyIntentPayload(savedInstanceState = null, sourceIntent = intent, reinitialize = contentReady)
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        if (
            newConfig.orientation == Configuration.ORIENTATION_LANDSCAPE ||
            newConfig.orientation == Configuration.ORIENTATION_PORTRAIT
        ) {
            updateLiveCanvasBounds(newConfig.orientation)
            viewModel.onDeviceOrientationChanged(newConfig.orientation)
        }
    }

    override fun onPause() {
        viewModel.onHostPaused()
        super.onPause()
        // Don't stop stream on pause; handled by LifecycleObserver
    }

    override fun onStop() {
        viewModel.onHostStopped(isChangingConfigurations = isChangingConfigurations)
        super.onStop()
    }

    override fun onDestroy() {
        Log.d(
            TAG,
            "onDestroy: isFinishing=$isFinishing, isChangingConfigurations=$isChangingConfigurations, " +
                "matchId=$pendingMatchId, courtId=$pendingCourtId"
        )
        viewModel.onHostDestroyed(
            isFinishing = isFinishing,
            isChangingConfigurations = isChangingConfigurations,
        )
        super.onDestroy()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        outState.putString(STATE_MATCH_ID, pendingMatchId)
        outState.putString(STATE_PAGE_ID, pendingPageId)
        outState.putString(STATE_COURT_ID, pendingCourtId)
        outState.putString(STATE_TOKEN, currentToken)
    }

    private fun checkAndRequestPermissions() {
        if (hasPermissions()) {
            initStream()
        } else {
            permissionsLauncher.launch(
                arrayOf(
                    Manifest.permission.CAMERA,
                    Manifest.permission.RECORD_AUDIO,
                )
            )
        }
    }

    private fun hasPermissions(): Boolean {
        return ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) ==
                PackageManager.PERMISSION_GRANTED &&
                ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) ==
                PackageManager.PERMISSION_GRANTED
    }

    private fun initStream() {
        Log.d(TAG, "Permissions granted -> ready to stream")
        // Preview will start via SurfaceHolder.Callback
    }
    private fun applyIntentPayload(
        savedInstanceState: Bundle?,
        sourceIntent: Intent?,
        reinitialize: Boolean,
    ) {
        val uri = sourceIntent?.data
        val explicitMatchId = sourceIntent?.getStringExtra(EXTRA_MATCH_ID).orEmpty()
        val explicitPageId = sourceIntent?.getStringExtra(EXTRA_PAGE_ID)
        val explicitCourtId = sourceIntent?.getStringExtra(EXTRA_COURT_ID).orEmpty()
        val explicitToken = sourceIntent?.getStringExtra(EXTRA_TOKEN).orEmpty()
        val matchId = savedInstanceState?.getString(STATE_MATCH_ID).orEmpty()
            .ifBlank { explicitMatchId }
            .ifBlank { uri?.getQueryParameter("matchId").orEmpty() }
        val pageId = savedInstanceState?.getString(STATE_PAGE_ID)
            ?: explicitPageId
            ?: uri?.getQueryParameter("pageId")
        val courtId = savedInstanceState?.getString(STATE_COURT_ID).orEmpty()
            .ifBlank { explicitCourtId }
            .ifBlank { uri?.getQueryParameter("courtId").orEmpty() }
        val deeplinkToken = savedInstanceState?.getString(STATE_TOKEN).orEmpty()
            .ifBlank { explicitToken }
            .ifBlank { uri?.getQueryParameter("token").orEmpty() }
        val storedToken = tokenStore.getSessionOrNull()?.accessToken.orEmpty()
        val tokenToUse = deeplinkToken.ifBlank { storedToken }

        if (matchId.isBlank() && courtId.isBlank()) {
            Log.e(TAG, "Missing matchId/courtId from intent")
        }
        Log.d(
            TAG,
            "Launch payload: matchId=$matchId, courtId=$courtId, hasToken=${tokenToUse.isNotBlank()}, " +
                "pageId=$pageId, reinitialize=$reinitialize"
        )

        pendingMatchId = matchId
        pendingPageId = pageId
        pendingCourtId = courtId
        currentToken = tokenToUse

        if (reinitialize) {
            routeToLiveTarget()
        }
    }

    private fun routeToLiveTarget() {
        when {
            pendingMatchId.isNotBlank() && currentToken.isNotBlank() -> {
                viewModel.init(pendingMatchId, currentToken, pendingPageId)
            }
            currentToken.isNotBlank() && pendingMatchId.isBlank() && pendingCourtId.isNotBlank() -> {
                viewModel.initByCourt(pendingCourtId, currentToken, pendingPageId)
            }
            currentToken.isBlank() && (pendingMatchId.isNotBlank() || pendingCourtId.isNotBlank()) -> {
                ensureLoggedInForStream()
            }
            currentToken.isBlank() -> {
                viewModel.showLiveIssue("Không tìm thấy phiên đăng nhập. Hãy quay lại đăng nhập rồi vào live lại.")
            }
            else -> {
                viewModel.showLiveIssue("Không có match/court hợp lệ để vào màn live.")
            }
        }
    }

    private fun ensureLoggedInForStream() {
        if (loginInFlight) return
        loginInFlight = true
        loginLauncher.launch(Intent(this, LoginActivity::class.java))
    }

    private fun updateLiveCanvasBounds(orientation: Int) {
        val root = findViewById<FrameLayout>(R.id.liveRoot) ?: return
        val surfaceView = findViewById<OpenGlView>(R.id.surfaceView) ?: return
        val composeView = findViewById<ComposeView>(R.id.composeView) ?: return
        val rootWidth = root.width.takeIf { it > 0 } ?: resources.displayMetrics.widthPixels
        val rootHeight = root.height.takeIf { it > 0 } ?: resources.displayMetrics.heightPixels
        val surfaceLayoutParams = surfaceView.layoutParams as? FrameLayout.LayoutParams ?: return
        val composeLayoutParams = composeView.layoutParams as? FrameLayout.LayoutParams ?: return

        if (orientation == Configuration.ORIENTATION_PORTRAIT) {
            val targetAspect = 9f / 16f
            var targetWidth = rootWidth
            var targetHeight = (targetWidth / targetAspect).toInt()
            if (targetHeight > rootHeight) {
                targetHeight = rootHeight
                targetWidth = (targetHeight * targetAspect).toInt()
            }
            surfaceLayoutParams.width = targetWidth
            surfaceLayoutParams.height = targetHeight
            surfaceLayoutParams.gravity = Gravity.CENTER
            composeLayoutParams.width = targetWidth
            composeLayoutParams.height = targetHeight
            composeLayoutParams.gravity = Gravity.CENTER
        } else {
            surfaceLayoutParams.width = FrameLayout.LayoutParams.MATCH_PARENT
            surfaceLayoutParams.height = FrameLayout.LayoutParams.MATCH_PARENT
            surfaceLayoutParams.gravity = Gravity.CENTER
            composeLayoutParams.width = FrameLayout.LayoutParams.MATCH_PARENT
            composeLayoutParams.height = FrameLayout.LayoutParams.MATCH_PARENT
            composeLayoutParams.gravity = Gravity.CENTER
        }

        surfaceView.layoutParams = surfaceLayoutParams
        composeView.layoutParams = composeLayoutParams
    }
}



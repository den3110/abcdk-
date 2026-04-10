package com.pkt.live.ui

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.widget.Toast
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.lifecycleScope
import com.pkt.live.BuildConfig
import com.pkt.live.data.api.AuthInterceptor
import com.pkt.live.data.auth.AuthSession
import com.pkt.live.data.auth.TokenStore
import com.pkt.live.data.model.LiveAppBootstrapResponse
import com.pkt.live.data.model.LoginRequest
import com.pkt.live.data.observer.LiveObserverConfig
import com.pkt.live.data.repository.LiveRepository
import com.pkt.live.ui.theme.PickletourLiveTheme
import kotlinx.coroutines.launch
import net.openid.appauth.AuthorizationException
import net.openid.appauth.AuthorizationRequest
import net.openid.appauth.AuthorizationResponse
import net.openid.appauth.AuthorizationService
import net.openid.appauth.AuthorizationServiceConfiguration
import net.openid.appauth.ResponseTypeValues
import org.koin.android.ext.android.inject

class LoginActivity : AppCompatActivity() {

    companion object {
        const val EXTRA_TOKEN = "extra_token"

        private const val OAUTH_PREFS = "live_oauth"
        private const val KEY_PENDING_AUTH_REQUEST = "pending_auth_request"
        private const val PICKLETOUR_APP_AUTH_SCHEME = "pickletourapp"
        private const val PICKLETOUR_APP_AUTH_HOST = "live-auth"
        private const val LIVE_APP_AUTH_INIT_URI = "pickletour-live://auth-init"
    }

    private val tokenStore: TokenStore by inject()
    private val repository: LiveRepository by inject()
    private val authInterceptor: AuthInterceptor by inject()

    private var authService: AuthorizationService? = null
    private var isAuthFlowLoading by mutableStateOf(false)

    private val oauthPrefs by lazy {
        getSharedPreferences(OAUTH_PREFS, Context.MODE_PRIVATE)
    }

    private val authLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        val data = result.data
        val resp = data?.let { AuthorizationResponse.fromIntent(it) }
        val ex = data?.let { AuthorizationException.fromIntent(it) }

        if (resp == null || ex != null) {
            clearPendingAuthorizationRequest()
            updateAuthFlowMessage(null)
            val msg =
                ex?.errorDescription
                    ?: ex?.localizedMessage
                    ?: "Đăng nhập đã bị hủy."
            toast(msg)
            return@registerForActivityResult
        }

        exchangeToken(resp)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val saved = tokenStore.getSessionOrNull()
        if (saved != null && saved.accessToken.isNotBlank()) {
            authInterceptor.token = saved.accessToken
        }

        setContent {
            PickletourLiveTheme {
                LoginScreen(
                    initialSession = saved,
                    isAuthFlowLoading = isAuthFlowLoading,
                    onContinueExistingSession = { session ->
                        lifecycleScope.launch {
                            validateAndFinishSession(session, clearOnBootstrapFailure = false)
                        }
                    },
                    onLogin = { startOAuth() },
                    onRefreshProfile = { refreshProfile() },
                    onPasswordLogin = { loginId, password -> passwordLogin(loginId, password) },
                    onPasswordLoginSuccess = { session -> finishWithToken(session.accessToken) },
                )
            }
        }

        handleAppHandoffIntent(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleAppHandoffIntent(intent)
    }

    override fun onDestroy() {
        authService?.dispose()
        authService = null
        super.onDestroy()
    }

    private suspend fun refreshProfile() {
        val session = tokenStore.getSessionOrNull() ?: return
        if (session.accessToken.isBlank()) return
        authInterceptor.token = session.accessToken
        repository.getMe().onSuccess { me ->
            tokenStore.updateUser(displayName = me.displayName(), userId = me.id)
        }
    }

    private fun startOAuth() {
        updateAuthFlowMessage("Đang mở PickleTour để xác thực...")
        val request = buildAuthorizationRequest()
        savePendingAuthorizationRequest(request)
        if (!launchPickleTourAppHandoff(request)) {
            launchAuthorizationRequest(request)
        }
    }

    private fun buildAuthorizationRequest(osAuthToken: String? = null): AuthorizationRequest {
        val serviceConfig =
            AuthorizationServiceConfiguration(
                Uri.parse(BuildConfig.OAUTH_AUTHORIZATION_ENDPOINT),
                Uri.parse(BuildConfig.OAUTH_TOKEN_ENDPOINT),
            )

        val builder =
            AuthorizationRequest.Builder(
                serviceConfig,
                BuildConfig.OAUTH_CLIENT_ID,
                ResponseTypeValues.CODE,
                Uri.parse(BuildConfig.OAUTH_REDIRECT_URI),
            ).setScope(BuildConfig.OAUTH_SCOPE)

        val normalizedOsAuthToken = osAuthToken?.trim().orEmpty()
        if (normalizedOsAuthToken.isNotBlank()) {
            builder.setAdditionalParameters(mapOf("os_auth_token" to normalizedOsAuthToken))
        }

        return builder.build()
    }

    private fun launchPickleTourAppHandoff(request: AuthorizationRequest): Boolean {
        val handoffUri =
            Uri.Builder()
                .scheme(PICKLETOUR_APP_AUTH_SCHEME)
                .authority(PICKLETOUR_APP_AUTH_HOST)
                .appendQueryParameter("continueUrl", request.toUri().toString())
                .appendQueryParameter("callbackUri", LIVE_APP_AUTH_INIT_URI)
                .build()

        val intent =
            Intent(Intent.ACTION_VIEW, handoffUri).apply {
                addCategory(Intent.CATEGORY_BROWSABLE)
            }

        return try {
            startActivity(intent)
            true
        } catch (_: ActivityNotFoundException) {
            false
        } catch (_: Exception) {
            false
        }
    }

    private fun launchAuthorizationRequest(request: AuthorizationRequest) {
        savePendingAuthorizationRequest(request)
        updateAuthFlowMessage("Đang mở trình duyệt để xác thực...")
        val svc = authService ?: AuthorizationService(this).also { authService = it }
        authLauncher.launch(svc.getAuthorizationRequestIntent(request))
    }

    private fun handleAppHandoffIntent(intent: Intent?) {
        val data = intent?.data ?: return
        if (data.scheme != "pickletour-live" || data.host != "auth-init") return
        updateAuthFlowMessage("Đang tiếp tục xác thực...")

        val osAuthToken = data.getQueryParameter("osAuthToken").orEmpty().trim()
        val pendingRequest = restorePendingAuthorizationRequest()
        val fallbackWebAuthMessage = "Đang mở trình duyệt để xác thực..."

        if (osAuthToken.isBlank()) {
            updateAuthFlowMessage(fallbackWebAuthMessage)
            toast("Không nhận được phiên đăng nhập từ app PickleTour. Chuyển sang xác thực web.")
            launchAuthorizationRequest(pendingRequest ?: buildAuthorizationRequest())
            return
        }

        val requestWithOsAuth =
            pendingRequest?.let {
                rebuildAuthorizationRequestWithOsAuth(it, osAuthToken)
            } ?: run {
                toast("Phiên xác thực app đã hết hạn. Tạo lại phiên mới.")
                buildAuthorizationRequest(osAuthToken)
            }

        launchAuthorizationRequest(requestWithOsAuth)
    }

    private fun rebuildAuthorizationRequestWithOsAuth(
        original: AuthorizationRequest,
        osAuthToken: String,
    ): AuthorizationRequest {
        val additionalParameters = LinkedHashMap(original.additionalParameters ?: emptyMap())
        additionalParameters["os_auth_token"] = osAuthToken

        return AuthorizationRequest.Builder(
            original.configuration,
            original.clientId,
            original.responseType,
            original.redirectUri,
        ).apply {
            if (!original.scope.isNullOrBlank()) setScope(original.scope)
            if (!original.state.isNullOrBlank()) setState(original.state)
            if (!original.nonce.isNullOrBlank()) setNonce(original.nonce)
            if (!original.display.isNullOrBlank()) setDisplay(original.display)
            if (!original.loginHint.isNullOrBlank()) setLoginHint(original.loginHint)
            if (!original.prompt.isNullOrBlank()) setPrompt(original.prompt)
            if (!original.uiLocales.isNullOrBlank()) setUiLocales(original.uiLocales)
            if (!original.responseMode.isNullOrBlank()) setResponseMode(original.responseMode)
            if (original.claims != null) setClaims(original.claims)
            if (!original.claimsLocales.isNullOrBlank()) setClaimsLocales(original.claimsLocales)
            if (!original.codeVerifier.isNullOrBlank()) {
                setCodeVerifier(
                    original.codeVerifier,
                    original.codeVerifierChallenge,
                    original.codeVerifierChallengeMethod,
                )
            }
            setAdditionalParameters(additionalParameters)
        }.build()
    }

    private fun exchangeToken(response: AuthorizationResponse) {
        updateAuthFlowMessage("Đang hoàn tất đăng nhập...")
        val svc = authService ?: AuthorizationService(this).also { authService = it }
        svc.performTokenRequest(response.createTokenExchangeRequest()) { tokenResponse, ex ->
            val accessToken = tokenResponse?.accessToken
            if (ex != null || accessToken.isNullOrBlank()) {
                clearPendingAuthorizationRequest()
                updateAuthFlowMessage(null)
                val msg =
                    ex?.errorDescription
                        ?: ex?.localizedMessage
                        ?: "Không lấy được token."
                toast(msg)
                return@performTokenRequest
            }

            clearPendingAuthorizationRequest()
            val session =
                AuthSession(
                    accessToken = accessToken,
                    refreshToken = tokenResponse.refreshToken,
                    idToken = tokenResponse.idToken,
                )

            updateAuthFlowMessage("Đang kiểm tra quyền dùng PickleTour Live...")
            lifecycleScope.launch {
                validateAndFinishSession(session, clearOnBootstrapFailure = true)
            }
        }
    }

    private suspend fun validateAndFinishSession(
        session: AuthSession,
        clearOnBootstrapFailure: Boolean,
    ) {
        updateAuthFlowMessage("Đang kiểm tra quyền dùng PickleTour Live...")
        authInterceptor.token = session.accessToken

        repository.getLiveAppBootstrap()
            .onSuccess { bootstrap ->
                if (!bootstrap.canUseLiveApp) {
                    updateAuthFlowMessage(null)
                    clearLiveAuthState()
                    toast(
                        bootstrap.message
                            ?: "Tài khoản này chưa có quyền dùng PickleTour Live."
                    )
                    return
                }

                val validatedSession = buildValidatedSession(session, bootstrap)
                tokenStore.saveSession(validatedSession)
                repository.getMe().onSuccess { me ->
                    tokenStore.updateUser(displayName = me.displayName(), userId = me.id)
                }
                updateAuthFlowMessage(null)
                finishWithToken(validatedSession.accessToken)
            }
            .onFailure { error ->
                updateAuthFlowMessage(null)
                if (clearOnBootstrapFailure) {
                    clearLiveAuthState()
                }
                toast(error.message ?: "Không kiểm tra được quyền dùng PickleTour Live.")
            }
    }

    private fun buildValidatedSession(
        session: AuthSession,
        bootstrap: LiveAppBootstrapResponse,
    ): AuthSession {
        val user = bootstrap.user
        return session.copy(
            userId = user?.id?.takeIf { it.isNotBlank() } ?: session.userId,
            displayName = user?.displayName()?.takeIf { it.isNotBlank() } ?: session.displayName,
        )
    }

    private fun finishWithToken(token: String) {
        updateAuthFlowMessage(null)
        authInterceptor.token = token
        repository.connectSocketSession(token)
        setResult(RESULT_OK, Intent().putExtra(EXTRA_TOKEN, token))
        finish()
    }

    private suspend fun passwordLogin(loginId: String, password: String): Result<AuthSession> {
        val id = loginId.trim()
        val pass = password.trim()
        if (id.isBlank() || pass.isBlank()) {
            val e = IllegalArgumentException("Thiếu thông tin.")
            toast(e.message ?: "Thiếu thông tin.")
            return Result.failure(e)
        }

        val body = buildPasswordLoginRequest(id, pass)
        val resp =
            repository.loginWithPassword(body).getOrElse {
                toast(it.message ?: "Đăng nhập thất bại.")
                return Result.failure(it)
            }
        val token =
            resp.token ?: run {
                val e = Exception("Không nhận được token.")
                toast(e.message ?: "Không nhận được token.")
                return Result.failure(e)
            }

        val provisionalSession =
            AuthSession(
                accessToken = token,
                userId = resp.user?.id?.takeIf { it.isNotBlank() },
                displayName = resp.user?.displayName(),
            )

        authInterceptor.token = token
        return repository.getLiveAppBootstrap()
            .mapCatching { bootstrap ->
                if (!bootstrap.canUseLiveApp) {
                    throw IllegalStateException(
                        bootstrap.message
                            ?: "Tài khoản này chưa có quyền dùng PickleTour Live."
                    )
                }
                val validated = buildValidatedSession(provisionalSession, bootstrap)
                tokenStore.saveSession(validated)
                repository.getMe().onSuccess { me ->
                    tokenStore.updateUser(displayName = me.displayName(), userId = me.id)
                }
                tokenStore.getSessionOrNull() ?: validated
            }.onFailure {
                clearLiveAuthState()
                toast(it.message ?: "Không kiểm tra được quyền dùng PickleTour Live.")
            }
    }

    private fun buildPasswordLoginRequest(loginId: String, password: String): LoginRequest {
        val normalized = loginId.trim()
        val isEmail = normalized.contains('@')
        val phone = normalizePhone(normalized)
        return when {
            isEmail -> LoginRequest(email = normalized.lowercase(), password = password)
            phone != null -> LoginRequest(phone = phone, password = password)
            else -> LoginRequest(nickname = normalized, password = password)
        }
    }

    private fun normalizePhone(raw: String): String? {
        var s = raw.trim()
        if (s.isBlank()) return null
        if (s.startsWith("+84")) s = "0" + s.drop(3)
        s = s.filter { it.isDigit() }
        val ok = s.matches(Regex("^0\\d{8,10}$"))
        return if (ok) s else null
    }

    private fun savePendingAuthorizationRequest(request: AuthorizationRequest) {
        oauthPrefs.edit().putString(KEY_PENDING_AUTH_REQUEST, request.jsonSerializeString()).apply()
    }

    private fun restorePendingAuthorizationRequest(): AuthorizationRequest? {
        val raw = oauthPrefs.getString(KEY_PENDING_AUTH_REQUEST, null)?.trim().orEmpty()
        if (raw.isBlank()) return null
        return runCatching { AuthorizationRequest.jsonDeserialize(raw) }.getOrNull()
    }

    private fun clearPendingAuthorizationRequest() {
        oauthPrefs.edit().remove(KEY_PENDING_AUTH_REQUEST).apply()
    }

    private fun clearLiveAuthState() {
        clearPendingAuthorizationRequest()
        tokenStore.clear()
        authInterceptor.token = null
        LiveObserverConfig.clearObserverBaseUrlOverride()
        repository.disconnectSocketSession()
    }

    private fun toast(message: String) {
        runOnUiThread {
            Toast.makeText(this, message, Toast.LENGTH_LONG).show()
        }
    }

    private fun updateAuthFlowMessage(message: String?) {
        runOnUiThread {
            isAuthFlowLoading = !message.isNullOrBlank()
        }
    }
}

@Composable
private fun LoginScreen(
    initialSession: AuthSession?,
    isAuthFlowLoading: Boolean,
    onContinueExistingSession: (AuthSession) -> Unit,
    onLogin: () -> Unit,
    onRefreshProfile: suspend () -> Unit,
    onPasswordLogin: suspend (String, String) -> Result<AuthSession>,
    onPasswordLoginSuccess: (AuthSession) -> Unit,
) {
    var isRefreshing by remember { mutableStateOf(false) }
    var showPasswordLogin by remember { mutableStateOf(false) }
    var showDiagnosticsTools by remember { mutableStateOf(BuildConfig.DEBUG) }
    var diagnosticsTapCount by remember { mutableStateOf(0) }
    var loginId by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var showPassword by remember { mutableStateOf(false) }
    var isSubmitting by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(initialSession?.accessToken) {
        if (!initialSession?.accessToken.isNullOrBlank()) {
            isRefreshing = true
            onRefreshProfile()
            isRefreshing = false
        }
    }

    Surface(
        modifier =
            Modifier
                .fillMaxSize()
                .background(Color.Black),
        color = Color.Black,
    ) {
        Column(
            modifier =
                Modifier
                    .fillMaxSize()
                    .padding(20.dp),
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Card(shape = RoundedCornerShape(16.dp)) {
                Column(
                    modifier = Modifier.padding(18.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Text(
                        text = "Đăng nhập PickleTour Live",
                        fontWeight = FontWeight.SemiBold,
                        fontSize = 18.sp,
                        modifier =
                            Modifier.clickable {
                                if (showDiagnosticsTools) return@clickable
                                diagnosticsTapCount += 1
                                if (diagnosticsTapCount >= 7) {
                                    diagnosticsTapCount = 0
                                    showDiagnosticsTools = true
                                }
                            },
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    Text(
                        text = "Đăng nhập bằng tài khoản PickleTour để tiếp tục.",
                        fontSize = 12.sp,
                        color = Color.Gray,
                    )
                    if (isAuthFlowLoading) {
                        Spacer(modifier = Modifier.height(12.dp))
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.Center,
                        ) {
                            CircularProgressIndicator(
                                strokeWidth = 2.5.dp,
                                modifier = Modifier.size(22.dp),
                            )
                        }
                    }
                    Spacer(modifier = Modifier.height(16.dp))

                    if (initialSession != null && initialSession.accessToken.isNotBlank()) {
                        Button(
                            onClick = { onContinueExistingSession(initialSession) },
                            enabled = !isAuthFlowLoading,
                            colors =
                                ButtonDefaults.buttonColors(
                                    containerColor = MaterialTheme.colorScheme.primary,
                                ),
                            modifier = Modifier.padding(horizontal = 4.dp),
                        ) {
                            val name =
                                initialSession.displayName?.takeIf { it.isNotBlank() }
                                    ?: "PickleTour"
                            Text(
                                text = "Tiếp tục với $name",
                                fontWeight = FontWeight.SemiBold,
                            )
                        }
                        Spacer(modifier = Modifier.height(10.dp))
                    }

                    if (showPasswordLogin) {
                        OutlinedTextField(
                            value = loginId,
                            onValueChange = { loginId = it },
                            modifier = Modifier.fillMaxWidth(),
                            label = { Text("Email / SĐT / Nickname") },
                            singleLine = true,
                            enabled = !isAuthFlowLoading,
                        )
                        Spacer(modifier = Modifier.height(10.dp))
                        OutlinedTextField(
                            value = password,
                            onValueChange = { password = it },
                            modifier = Modifier.fillMaxWidth(),
                            label = { Text("Mật khẩu") },
                            singleLine = true,
                            enabled = !isAuthFlowLoading,
                            visualTransformation =
                                if (showPassword) {
                                    VisualTransformation.None
                                } else {
                                    PasswordVisualTransformation()
                                },
                        )
                        Spacer(modifier = Modifier.height(8.dp))
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            TextButton(
                                onClick = { showPassword = !showPassword },
                                enabled = !isSubmitting && !isAuthFlowLoading,
                            ) {
                                Text(if (showPassword) "Ẩn mật khẩu" else "Hiện mật khẩu")
                            }
                            Button(
                                onClick = {
                                    if (isSubmitting || isAuthFlowLoading) return@Button
                                    isSubmitting = true
                                    val id = loginId
                                    val pass = password
                                    scope.launch {
                                        val result = onPasswordLogin(id, pass)
                                        isSubmitting = false
                                        result.getOrNull()?.let(onPasswordLoginSuccess)
                                    }
                                },
                                enabled = !isSubmitting && !isAuthFlowLoading,
                                colors =
                                    ButtonDefaults.buttonColors(
                                        containerColor = MaterialTheme.colorScheme.primary,
                                    ),
                            ) {
                                if (isSubmitting) {
                                    CircularProgressIndicator(
                                        strokeWidth = 2.dp,
                                        modifier = Modifier.size(16.dp),
                                    )
                                } else {
                                    Text("Đăng nhập")
                                }
                            }
                        }
                        Spacer(modifier = Modifier.height(10.dp))
                    }

                    Spacer(modifier = Modifier.height(6.dp))
                    Button(
                        onClick = onLogin,
                        enabled = !isAuthFlowLoading,
                        colors =
                            ButtonDefaults.buttonColors(
                                containerColor = MaterialTheme.colorScheme.secondary,
                            ),
                        modifier = Modifier.padding(horizontal = 4.dp),
                    ) {
                        Text(
                            text = "Tiếp tục với PickleTour",
                            fontWeight = FontWeight.SemiBold,
                        )
                    }

                    Spacer(modifier = Modifier.height(6.dp))
                    TextButton(
                        onClick = { showPasswordLogin = !showPasswordLogin },
                        enabled = !isSubmitting && !isAuthFlowLoading,
                    ) {
                        Text(if (showPasswordLogin) "Quay lại" else "Đăng nhập bằng mật khẩu")
                    }

                    if (isRefreshing) {
                        Spacer(modifier = Modifier.height(14.dp))
                        CircularProgressIndicator(strokeWidth = 2.dp)
                    }
                }
            }

            if (showDiagnosticsTools) {
                Spacer(modifier = Modifier.height(20.dp))
                Button(
                    onClick = {
                        throw RuntimeException("Crashlytics test crash — nếu thấy trên Firebase Console là Crashlytics hoạt động!")
                    },
                    colors = ButtonDefaults.buttonColors(
                        containerColor = Color(0xFFDC2626),
                    ),
                    modifier = Modifier.padding(horizontal = 4.dp),
                ) {
                    Text(
                        text = "💥 Test Crash",
                        fontWeight = FontWeight.SemiBold,
                        fontSize = 12.sp,
                        color = Color.White,
                    )
                }
            } else if (!BuildConfig.DEBUG && diagnosticsTapCount > 0) {
                Spacer(modifier = Modifier.height(12.dp))
                Text(
                    text = "Nhấn thêm ${7 - diagnosticsTapCount} lần vào tiêu đề để mở công cụ test.",
                    fontSize = 11.sp,
                    color = Color.Gray,
                )
            }

            Spacer(modifier = Modifier.height(24.dp))
            Text(
                text = "App build ${BuildConfig.VERSION_NAME}",
                fontSize = 11.sp,
                color = Color.White.copy(alpha = 0.65f),
            )
        }
    }
}

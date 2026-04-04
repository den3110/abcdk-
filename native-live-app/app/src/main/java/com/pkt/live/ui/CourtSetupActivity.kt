package com.pkt.live.ui

import android.content.Intent
import android.os.Bundle
import androidx.activity.compose.setContent
import androidx.appcompat.app.AppCompatActivity
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
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
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.pkt.live.data.api.AuthInterceptor
import com.pkt.live.data.auth.TokenStore
import com.pkt.live.data.repository.LiveRepository
import com.pkt.live.ui.theme.PickletourLiveTheme
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.koin.android.ext.android.inject

class CourtSetupActivity : AppCompatActivity() {

    companion object {
        const val EXTRA_MATCH_ID = "extra_match_id"
        const val EXTRA_PAGE_ID = "extra_page_id"
        const val EXTRA_COURT_ID = "extra_court_id"
        const val EXTRA_AUTO_WAIT = "extra_auto_wait"
    }

    private val repository: LiveRepository by inject()
    private val tokenStore: TokenStore by inject()
    private val authInterceptor: AuthInterceptor by inject()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val savedToken = tokenStore.getSessionOrNull()?.accessToken
        if (!savedToken.isNullOrBlank()) authInterceptor.token = savedToken

        val initialCourtId = intent?.getStringExtra(EXTRA_COURT_ID).orEmpty()
        val autoWait = intent?.getBooleanExtra(EXTRA_AUTO_WAIT, false) == true

        setContent {
            PickletourLiveTheme {
                CourtSetupScreen(
                    initialCourtId = initialCourtId,
                    autoWaitByCourt = autoWait,
                    onWaitByCourt = { courtId -> waitForMatchIdByCourt(courtId) },
                    onUseMatchId = { matchId, pageId ->
                        finishWithMatch(matchId = matchId, pageId = pageId)
                    },
                    onCancel = { finish() },
                )
            }
        }
    }

    private suspend fun waitForMatchIdByCourt(courtId: String): Result<String> {
        val id = courtId.trim()
        if (id.isBlank()) return Result.failure(IllegalArgumentException("Thiếu courtId"))
        while (true) {
            val runtime = repository.getCourtRuntime(id).getOrNull()
            val matchId =
                runtime?.currentMatchId?.takeIf { it.isNotBlank() }
                    ?: runtime?.nextMatchId?.takeIf { it.isNotBlank() }
            if (!matchId.isNullOrBlank()) return Result.success(matchId)
            delay(1500)
        }
    }

    private fun finishWithMatch(matchId: String, pageId: String?) {
        val mid = matchId.trim()
        if (mid.isBlank()) return
        val pid = pageId?.trim()?.takeIf { it.isNotBlank() }
        setResult(
            RESULT_OK,
            Intent()
                .putExtra(EXTRA_MATCH_ID, mid)
                .putExtra(EXTRA_PAGE_ID, pid),
        )
        finish()
    }
}

@Composable
private fun CourtSetupScreen(
    initialCourtId: String,
    autoWaitByCourt: Boolean,
    onWaitByCourt: suspend (String) -> Result<String>,
    onUseMatchId: (String, String?) -> Unit,
    onCancel: () -> Unit,
) {
    var courtId by remember { mutableStateOf(initialCourtId) }
    var matchId by remember { mutableStateOf("") }
    var pageId by remember { mutableStateOf("") }
    var isSubmitting by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    var autoStarted by remember { mutableStateOf(false) }
    androidx.compose.runtime.LaunchedEffect(autoWaitByCourt, initialCourtId) {
        if (!autoWaitByCourt) return@LaunchedEffect
        if (autoStarted) return@LaunchedEffect
        if (initialCourtId.isBlank()) return@LaunchedEffect
        autoStarted = true
        isSubmitting = true
        error = null
        val cid = initialCourtId
        val pid = pageId.takeIf { it.isNotBlank() }
        val result = onWaitByCourt(cid)
        isSubmitting = false
        val mid = result.getOrNull()
        if (mid != null) {
            onUseMatchId(mid, pid)
        } else {
            error = result.exceptionOrNull()?.message ?: "Không thể lấy trận theo sân"
        }
    }

    Surface(
        modifier = Modifier
            .fillMaxSize()
            .background(Color.Black),
        color = Color.Black,
    ) {
        Column(
            modifier = Modifier
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
                        text = "Live theo sân",
                        fontWeight = FontWeight.SemiBold,
                        fontSize = 18.sp,
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    Text(
                        text = "Nhập courtStationId/courtId để lấy trận hiện tại và tự join socket overlay.",
                        fontSize = 12.sp,
                        color = Color.Gray,
                    )
                    Spacer(modifier = Modifier.height(16.dp))

                    OutlinedTextField(
                        value = courtId,
                        onValueChange = { courtId = it; error = null },
                        modifier = Modifier.fillMaxWidth(),
                        label = { Text("courtStationId / courtId") },
                        singleLine = true,
                        enabled = !isSubmitting,
                    )
                    Spacer(modifier = Modifier.height(10.dp))

                    Button(
                        onClick = {
                            if (isSubmitting) return@Button
                            isSubmitting = true
                            error = null
                            val cid = courtId
                            scope.launch {
                                val result = onWaitByCourt(cid)
                                isSubmitting = false
                                val mid = result.getOrNull()
                                if (mid != null) {
                                    onUseMatchId(mid, pageId.takeIf { it.isNotBlank() })
                                } else {
                                    error = result.exceptionOrNull()?.message ?: "Không thể lấy trận theo sân"
                                }
                            }
                        },
                        enabled = !isSubmitting,
                        colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.primary),
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        if (isSubmitting) {
                            CircularProgressIndicator(strokeWidth = 2.dp, modifier = Modifier.height(16.dp))
                        } else {
                            Text("LIVE theo sân")
                        }
                    }

                    Spacer(modifier = Modifier.height(18.dp))

                    Text(
                        text = "Hoặc nhập matchId trực tiếp",
                        fontSize = 12.sp,
                        color = Color.Gray,
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    OutlinedTextField(
                        value = matchId,
                        onValueChange = { matchId = it; error = null },
                        modifier = Modifier.fillMaxWidth(),
                        label = { Text("matchId") },
                        singleLine = true,
                        enabled = !isSubmitting,
                    )
                    Spacer(modifier = Modifier.height(10.dp))
                    OutlinedTextField(
                        value = pageId,
                        onValueChange = { pageId = it; error = null },
                        modifier = Modifier.fillMaxWidth(),
                        label = { Text("pageId (tuỳ chọn)") },
                        singleLine = true,
                        enabled = !isSubmitting,
                    )
                    Spacer(modifier = Modifier.height(10.dp))
                    Button(
                        onClick = { onUseMatchId(matchId, pageId.takeIf { it.isNotBlank() }) },
                        enabled = !isSubmitting && matchId.trim().isNotBlank(),
                        colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.secondary),
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Text("Tiếp tục")
                    }

                    error?.let {
                        Spacer(modifier = Modifier.height(10.dp))
                        Text(text = it, color = Color(0xFFFF6B6B), fontSize = 12.sp)
                    }

                    Spacer(modifier = Modifier.height(8.dp))
                    TextButton(onClick = onCancel) {
                        Text("Đóng")
                    }
                }
            }
        }
    }
}

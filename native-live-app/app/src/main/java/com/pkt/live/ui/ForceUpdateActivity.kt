package com.pkt.live.ui

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.widget.Toast
import androidx.activity.compose.BackHandler
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
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.pkt.live.BuildConfig
import com.pkt.live.data.model.LiveAppVersionResponse
import com.pkt.live.data.repository.LiveRepository
import com.pkt.live.ui.theme.PickletourLiveTheme
import kotlinx.coroutines.withTimeoutOrNull

private const val UPDATE_CHECK_TIMEOUT_MS = 3_500L

object LiveAppUpdateGate {
    suspend fun requiredUpdateOrNull(repository: LiveRepository): LiveAppVersionResponse? {
        val response =
            withTimeoutOrNull(UPDATE_CHECK_TIMEOUT_MS) {
                repository.checkLiveAppVersion().getOrNull()
            }
        return response?.takeIf { it.forceUpdate }
    }

    fun showRequiredUpdate(activity: Activity, update: LiveAppVersionResponse) {
        activity.startActivity(ForceUpdateActivity.createIntent(activity, update))
        activity.finish()
    }
}

class ForceUpdateActivity : AppCompatActivity() {
    companion object {
        private const val EXTRA_LATEST_VERSION = "extra_latest_version"
        private const val EXTRA_LATEST_BUILD = "extra_latest_build"
        private const val EXTRA_MIN_BUILD = "extra_min_build"
        private const val EXTRA_DOWNLOAD_URL = "extra_download_url"
        private const val EXTRA_MESSAGE = "extra_message"
        private const val EXTRA_CHANGELOG = "extra_changelog"

        fun createIntent(context: Context, update: LiveAppVersionResponse): Intent =
            Intent(context, ForceUpdateActivity::class.java).apply {
                putExtra(EXTRA_LATEST_VERSION, update.latestVersion.orEmpty())
                putExtra(EXTRA_LATEST_BUILD, update.latestBuild)
                putExtra(EXTRA_MIN_BUILD, update.minSupportedBuild)
                putExtra(EXTRA_DOWNLOAD_URL, update.updateUrl().orEmpty())
                putExtra(EXTRA_MESSAGE, update.message)
                putExtra(EXTRA_CHANGELOG, update.changelog)
            }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val latestVersion = intent.getStringExtra(EXTRA_LATEST_VERSION).orEmpty()
        val latestBuild = intent.getIntExtra(EXTRA_LATEST_BUILD, 0)
        val minBuild = intent.getIntExtra(EXTRA_MIN_BUILD, 0)
        val downloadUrl = intent.getStringExtra(EXTRA_DOWNLOAD_URL).orEmpty()
        val message =
            intent.getStringExtra(EXTRA_MESSAGE)
                ?.takeIf { it.isNotBlank() }
                ?: "Phiên bản PickleTour Live đang dùng đã cũ. Vui lòng cập nhật APK mới để tiếp tục."
        val changelog = intent.getStringExtra(EXTRA_CHANGELOG).orEmpty()

        setContent {
            PickletourLiveTheme {
                ForceUpdateScreen(
                    latestVersion = latestVersion,
                    latestBuild = latestBuild,
                    minBuild = minBuild,
                    downloadUrl = downloadUrl,
                    message = message,
                    changelog = changelog,
                    onOpenUpdate = { openUpdateLink(downloadUrl) },
                )
            }
        }
    }

    private fun openUpdateLink(url: String) {
        val target = url.trim()
        if (target.isBlank()) {
            Toast.makeText(this, "Chưa có link APK để cập nhật.", Toast.LENGTH_LONG).show()
            return
        }
        val intent =
            Intent(Intent.ACTION_VIEW, Uri.parse(target)).apply {
                addCategory(Intent.CATEGORY_BROWSABLE)
            }
        try {
            startActivity(intent)
        } catch (_: ActivityNotFoundException) {
            Toast.makeText(this, "Không mở được link cập nhật.", Toast.LENGTH_LONG).show()
        } catch (_: Exception) {
            Toast.makeText(this, "Không mở được link cập nhật.", Toast.LENGTH_LONG).show()
        }
    }
}

@Composable
fun LiveAppUpdateCheckingScreen() {
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
            CircularProgressIndicator(strokeWidth = 2.5.dp)
            Spacer(modifier = Modifier.height(14.dp))
            Text(
                text = "Đang kiểm tra phiên bản...",
                color = Color.White.copy(alpha = 0.8f),
                fontSize = 13.sp,
            )
        }
    }
}

@Composable
private fun ForceUpdateScreen(
    latestVersion: String,
    latestBuild: Int,
    minBuild: Int,
    downloadUrl: String,
    message: String,
    changelog: String,
    onOpenUpdate: () -> Unit,
) {
    BackHandler(enabled = true) {}

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
            Card(shape = RoundedCornerShape(8.dp)) {
                Column(
                    modifier =
                        Modifier
                            .fillMaxWidth()
                            .padding(18.dp),
                    horizontalAlignment = Alignment.Start,
                ) {
                    Text(
                        text = "Cần cập nhật PickleTour Live",
                        fontWeight = FontWeight.SemiBold,
                        fontSize = 18.sp,
                    )
                    Spacer(modifier = Modifier.height(10.dp))
                    Text(
                        text = message,
                        fontSize = 13.sp,
                        color = Color.Gray,
                    )
                    Spacer(modifier = Modifier.height(14.dp))
                    Text(
                        text = "Đang dùng: ${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})",
                        fontSize = 12.sp,
                        color = Color.Gray,
                    )
                    if (latestVersion.isNotBlank() || latestBuild > 0) {
                        Spacer(modifier = Modifier.height(4.dp))
                        Text(
                            text = "Bản mới: ${latestVersion.ifBlank { "APK mới" }}${if (latestBuild > 0) " ($latestBuild)" else ""}",
                            fontSize = 12.sp,
                            color = Color.Gray,
                        )
                    }
                    if (minBuild > 0) {
                        Spacer(modifier = Modifier.height(4.dp))
                        Text(
                            text = "Yêu cầu tối thiểu: build $minBuild",
                            fontSize = 12.sp,
                            color = Color.Gray,
                        )
                    }
                    if (changelog.isNotBlank()) {
                        Spacer(modifier = Modifier.height(12.dp))
                        Text(
                            text = changelog,
                            fontSize = 12.sp,
                            color = Color.Gray,
                        )
                    }
                    Spacer(modifier = Modifier.height(18.dp))
                    Button(
                        onClick = onOpenUpdate,
                        enabled = downloadUrl.isNotBlank(),
                        colors =
                            ButtonDefaults.buttonColors(
                                containerColor = MaterialTheme.colorScheme.primary,
                            ),
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Text(
                            text = if (downloadUrl.isNotBlank()) "Cập nhật APK" else "Chưa có link APK",
                            fontWeight = FontWeight.SemiBold,
                        )
                    }
                }
            }
        }
    }
}

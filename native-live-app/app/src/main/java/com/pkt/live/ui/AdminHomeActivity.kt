package com.pkt.live.ui

import android.content.Intent
import android.os.Bundle
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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.google.gson.JsonElement
import com.google.gson.JsonObject
import com.google.gson.JsonPrimitive
import com.pkt.live.data.api.AuthInterceptor
import com.pkt.live.data.auth.TokenStore
import com.pkt.live.data.model.AdminCourtData
import com.pkt.live.data.model.CourtClusterData
import com.pkt.live.data.model.CourtLiveScreenPresence
import com.pkt.live.data.model.MatchData
import com.pkt.live.data.repository.LiveRepository
import com.pkt.live.ui.theme.LiveColors
import com.pkt.live.ui.theme.PickletourLiveTheme
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import org.koin.android.ext.android.inject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class AdminHomeActivity : AppCompatActivity() {
    private val repository: LiveRepository by inject()
    private val tokenStore: TokenStore by inject()
    private val authInterceptor: AuthInterceptor by inject()

    private val tokenState = mutableStateOf("")

    private val loginLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        val t = result.data?.getStringExtra(LoginActivity.EXTRA_TOKEN).orEmpty()
        if (t.isNotBlank()) {
            tokenState.value = t
            authInterceptor.token = t
            repository.connectSocketSession(t)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val saved = tokenStore.getSessionOrNull()?.accessToken.orEmpty()
        tokenState.value = saved
        if (saved.isNotBlank()) {
            authInterceptor.token = saved
            repository.connectSocketSession(saved)
        }

        setContent {
            PickletourLiveTheme {
                AdminHomeScreen(
                    initialToken = tokenState.value,
                    onRequireLogin = { loginLauncher.launch(Intent(this, LoginActivity::class.java)) },
                    onLogout = {
                        repository.unwatchTournamentCourtPresence()
                        repository.disconnectSocketSession()
                        tokenStore.clear()
                        authInterceptor.token = null
                        tokenState.value = ""
                        loginLauncher.launch(Intent(this, LoginActivity::class.java))
                    },
                    repository = repository,
                    onStartLiveByCourt = { courtId ->
                        startActivity(
                            Intent(this@AdminHomeActivity, LiveStreamActivity::class.java).apply {
                                putExtra(LiveStreamActivity.EXTRA_COURT_ID, courtId)
                                addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
                            }
                        )
                    },
                )
            }
        }
    }

}

private const val CLUSTER_LIST_REFRESH_INTERVAL_MS = 10_000L
private const val COURT_LIST_REFRESH_INTERVAL_MS = 5_000L
private const val COURT_DETAILS_POLL_INTERVAL_MS = 10_000L
private const val MATCH_DETAILS_REFRESH_INTERVAL_MS = 15_000L

private enum class AdminStep {
    CLUSTERS,
    COURTS,
    COURT_MATCH,
}

@Composable
private fun AdminHomeScreen(
    initialToken: String,
    onRequireLogin: () -> Unit,
    onLogout: () -> Unit,
    repository: LiveRepository,
    onStartLiveByCourt: (String) -> Unit,
) {
    var step by remember { mutableStateOf(AdminStep.CLUSTERS) }
    var isLoading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    var clusters by remember { mutableStateOf<List<CourtClusterData>>(emptyList()) }
    var courts by remember { mutableStateOf<List<AdminCourtData>>(emptyList()) }

    var selectedCluster by remember { mutableStateOf<CourtClusterData?>(null) }
    var selectedCourt by remember { mutableStateOf<AdminCourtData?>(null) }

    var currentMatchId by remember { mutableStateOf<String?>(null) }
    var currentMatch by remember { mutableStateOf<MatchData?>(null) }
    var isMatchLoading by remember { mutableStateOf(false) }
    var matchLoadError by remember { mutableStateOf<String?>(null) }
    var isLaunchingLive by remember { mutableStateOf(false) }
    var occupiedCourtMessage by remember { mutableStateOf<String?>(null) }
    var showLogoutConfirm by remember { mutableStateOf(false) }

    val lifecycleOwner = LocalLifecycleOwner.current
    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) {
                isLaunchingLive = false
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose {
            lifecycleOwner.lifecycle.removeObserver(observer)
        }
    }

    val scope = rememberCoroutineScope()

    LaunchedEffect(initialToken) {
        if (initialToken.isBlank()) {
            step = AdminStep.CLUSTERS
            clusters = emptyList()
            courts = emptyList()
            selectedCluster = null
            selectedCourt = null
            currentMatchId = null
            currentMatch = null
            onRequireLogin()
        }
    }

    LaunchedEffect(courts, selectedCourt?.id) {
        val selectedId = selectedCourt?.id ?: return@LaunchedEffect
        selectedCourt = courts.firstOrNull { it.id == selectedId } ?: selectedCourt
    }

    LaunchedEffect(
        step,
        selectedCourt?.id,
    ) {
        if (step != AdminStep.COURT_MATCH) return@LaunchedEffect
        selectedCourt ?: return@LaunchedEffect
        currentMatchId = null
        currentMatch = null
        matchLoadError = null
        isMatchLoading = true
    }

    DisposableEffect(initialToken, selectedCourt?.id) {
        val courtId = selectedCourt?.id?.takeIf { it.isNotBlank() }
        if (initialToken.isNotBlank() && !courtId.isNullOrBlank()) {
            repository.watchCourtStationRuntime(courtId)
        }
        onDispose {
            if (!courtId.isNullOrBlank()) {
                repository.unwatchCourtStationRuntime(courtId)
            }
        }
    }

    LaunchedEffect(initialToken, selectedCourt?.id) {
        val courtId = selectedCourt?.id?.takeIf { it.isNotBlank() } ?: return@LaunchedEffect
        if (initialToken.isBlank()) return@LaunchedEffect
        repository.courtStationRuntimeUpdates.collect { snapshot ->
            val station = snapshot.station ?: return@collect
            if (station.id != courtId) return@collect
            val previousMatchId = currentMatchId?.takeIf { it.isNotBlank() }
            selectedCourt = station
            courts = courts.map { existing -> if (existing.id == station.id) station else existing }
            val summaryMatch = buildPreferredCourtMatchSummary(station)
            val runtimeMatch =
                snapshot.currentMatch
                    ?.takeIf { isLiveCourtMatchStatus(it.status) }
            val resolvedMatch = resolveCurrentCourtMatch(runtimeMatch, summaryMatch, currentMatch)
            val resolvedMatchId =
                resolvedMatch?.id?.takeIf { it.isNotBlank() }
                    ?: runtimeMatch?.id?.takeIf { it.isNotBlank() }
                    ?: summaryMatch?.id?.takeIf { it.isNotBlank() }
            currentMatchId = resolvedMatchId
            if (resolvedMatch != null) {
                currentMatch = resolvedMatch
                matchLoadError = null
                isMatchLoading = false
                val shouldHydrateMatch =
                    !resolvedMatchId.isNullOrBlank() &&
                        (previousMatchId != resolvedMatchId || isPlaceholderMatch(resolvedMatch))
                if (shouldHydrateMatch) {
                    isMatchLoading = true
                    scope.launch {
                        repository.getMatchRuntime(resolvedMatchId)
                            .onSuccess { freshMatch ->
                                if (currentMatchId == resolvedMatchId) {
                                    currentMatch = mergeCourtMatchDetails(freshMatch, currentMatch)
                                    matchLoadError = null
                                }
                            }
                            .onFailure { fetchError ->
                                if (currentMatchId == resolvedMatchId) {
                                    matchLoadError = fetchError.message ?: "Không tải được thông tin trận"
                                }
                            }
                        if (currentMatchId == resolvedMatchId) {
                            isMatchLoading = false
                        }
                    }
                }
            } else {
                currentMatch = null
                matchLoadError = null
                isMatchLoading = false
            }
        }
    }

    LaunchedEffect(initialToken, step, selectedCluster?.id) {
        if (initialToken.isBlank()) return@LaunchedEffect
        while (isActive && initialToken.isNotBlank() && step != AdminStep.COURT_MATCH) {
            repository.listLiveAppCourtClusters()
                .onSuccess { refreshedClusters ->
                    clusters = refreshedClusters
                    val selectedClusterId = selectedCluster?.id?.takeIf { it.isNotBlank() }
                    if (!selectedClusterId.isNullOrBlank()) {
                        selectedCluster =
                            refreshedClusters.firstOrNull { it.id == selectedClusterId } ?: selectedCluster
                    }
                }
                .onFailure { fetchError ->
                    if (clusters.isEmpty()) {
                        error = fetchError.message ?: "Không tải được danh sách cụm sân"
                    }
                }
            delay(CLUSTER_LIST_REFRESH_INTERVAL_MS)
        }
    }

    LaunchedEffect(initialToken, selectedCluster?.id) {
        val clusterId = selectedCluster?.id ?: return@LaunchedEffect
        if (initialToken.isBlank()) return@LaunchedEffect
        while (isActive && selectedCluster?.id == clusterId) {
            repository.listLiveAppCourtStations(clusterId).onSuccess { refreshedCourts ->
                courts = refreshedCourts
                selectedCourt =
                    refreshedCourts.firstOrNull { it.id == selectedCourt?.id } ?: selectedCourt
            }
            delay(COURT_LIST_REFRESH_INTERVAL_MS)
        }
    }

    LaunchedEffect(initialToken, selectedCourt?.id) {
        val cid = selectedCourt?.id ?: return@LaunchedEffect
        var lastMatchFetchAt = 0L
        while (isActive) {
            repository.getCourtRuntime(cid).onSuccess { court ->
                val matchId = court.currentMatchId?.takeIf { it.isNotBlank() }
                val runtimeSummary =
                    selectedCourt
                        ?.let(::buildPreferredCourtMatchSummary)
                        ?.takeIf { summary ->
                            summary.id.takeIf { it.isNotBlank() } == matchId &&
                                isLiveCourtMatchStatus(summary.status)
                        }
                if (matchId != currentMatchId) {
                    currentMatchId = matchId
                    currentMatch = runtimeSummary
                    matchLoadError = null
                    if (!matchId.isNullOrBlank()) {
                        isMatchLoading = true
                        repository.getMatchRuntime(matchId)
                            .onSuccess { m ->
                                currentMatch = mergeCourtMatchDetails(m, runtimeSummary)
                                matchLoadError = null
                            }
                            .onFailure { e ->
                                currentMatch = runtimeSummary
                                matchLoadError = e.message ?: "Không tải được thông tin trận"
                            }
                        isMatchLoading = false
                        lastMatchFetchAt = System.currentTimeMillis()
                    } else {
                        isMatchLoading = false
                        lastMatchFetchAt = 0L
                    }
                } else if (matchId.isNullOrBlank()) {
                    currentMatchId = null
                    currentMatch = null
                    matchLoadError = null
                    isMatchLoading = false
                    lastMatchFetchAt = 0L
                } else if (!matchId.isNullOrBlank()) {
                    val now = System.currentTimeMillis()
                    val displayedMatchId = currentMatch?.id?.takeIf { it.isNotBlank() }
                    val shouldForceRefresh =
                        displayedMatchId != matchId || isPlaceholderMatch(currentMatch)
                    if (
                        !isMatchLoading &&
                            (shouldForceRefresh ||
                                now - lastMatchFetchAt >= MATCH_DETAILS_REFRESH_INTERVAL_MS)
                    ) {
                        isMatchLoading = true
                        repository.getMatchRuntime(matchId)
                            .onSuccess { m ->
                                currentMatch = mergeCourtMatchDetails(m, runtimeSummary ?: currentMatch)
                                matchLoadError = null
                            }
                            .onFailure { e ->
                                matchLoadError = e.message ?: "Không tải được thông tin trận"
                            }
                        isMatchLoading = false
                        lastMatchFetchAt = now
                    }
                }
            }
            delay(COURT_DETAILS_POLL_INTERVAL_MS)
        }
    }

    LaunchedEffect(initialToken) {
        if (initialToken.isBlank()) return@LaunchedEffect
        if (clusters.isNotEmpty()) return@LaunchedEffect
        isLoading = true
        error = null
        repository.getLiveAppBootstrap()
            .onSuccess { bootstrap ->
                if (bootstrap.canUseLiveApp) {
                    clusters = bootstrap.manageableCourtClusters
                    repository.listLiveAppCourtClusters()
                        .onSuccess { refreshedClusters -> clusters = refreshedClusters }
                        .onFailure { /* keep bootstrap payload as fallback */ }
                    error =
                        if (bootstrap.manageableCourtClusters.isEmpty()) {
                            "Tài khoản này chưa có cụm sân nào để dùng PickleTour Live."
                        } else {
                            null
                        }
                } else {
                    clusters = emptyList()
                    error = bootstrap.message ?: "Tài khoản này chưa có quyền dùng PickleTour Live."
                }
            }
            .onFailure { error = it.message ?: "Không tải được danh sách cụm sân" }
        isLoading = false
    }

    Surface(
        modifier = Modifier.fillMaxSize(),
        color = MaterialTheme.colorScheme.background,
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(16.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    if (step != AdminStep.CLUSTERS) {
                        IconButton(
                            onClick = {
                                when (step) {
                                    AdminStep.COURTS -> {
                                        step = AdminStep.CLUSTERS
                                        selectedCluster = null
                                        selectedCourt = null
                                        currentMatchId = null
                                        currentMatch = null
                                    }
                                    AdminStep.COURT_MATCH -> {
                                        step = AdminStep.COURTS
                                        selectedCourt = null
                                        currentMatchId = null
                                        currentMatch = null
                                    }
                                    AdminStep.CLUSTERS -> Unit
                                }
                            },
                        ) {
                            Icon(
                                imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                                contentDescription = "Quay lại",
                                tint = Color.White,
                            )
                        }
                    }

                    Text(
                        text = when (step) {
                            AdminStep.CLUSTERS -> "Chọn cụm sân"
                            AdminStep.COURTS -> "Chọn sân"
                            AdminStep.COURT_MATCH -> "Chọn trận"
                        },
                        color = Color.White,
                        fontWeight = FontWeight.SemiBold,
                        fontSize = 18.sp,
                    )
                }
                TextButton(onClick = { showLogoutConfirm = true }) {
                    Text("Đăng xuất")
                }
            }

            Spacer(modifier = Modifier.height(12.dp))

            if (isLoading) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.Center,
                ) {
                    CircularProgressIndicator(strokeWidth = 2.dp)
                }
                Spacer(modifier = Modifier.height(12.dp))
            }

            error?.let {
                Text(text = it, color = Color(0xFFFF6B6B), fontSize = 12.sp)
                Spacer(modifier = Modifier.height(8.dp))
            }

            when (step) {
                AdminStep.CLUSTERS -> {
                    LazyColumn(
                        modifier = Modifier.fillMaxSize(),
                    ) {
                        items(
                            items = clusters,
                            key = { cluster -> cluster.id.ifBlank { cluster.displayName() } },
                        ) { cluster ->
                            SelectCard(
                                title = cluster.displayName(),
                                subtitle = buildClusterSubtitle(cluster),
                                detailText = buildClusterAssignedTournamentDetail(cluster),
                                trailingChipText = buildClusterTrailingChip(cluster),
                                onClick = {
                                    selectedCluster = cluster
                                    step = AdminStep.COURTS
                                    isLoading = true
                                    error = null
                                    scope.launch {
                                        repository.listLiveAppCourtStations(cluster.id)
                                            .onSuccess { courts = it }
                                            .onFailure { error = it.message ?: "Không tải được danh sách sân" }
                                        isLoading = false
                                    }
                                },
                            )
                            Spacer(modifier = Modifier.height(10.dp))
                        }
                    }
                }
                AdminStep.COURTS -> {
                    val cluster = selectedCluster
                    if (cluster == null) {
                        step = AdminStep.CLUSTERS
                    } else {
                        Text(
                            text = cluster.displayName(),
                            color = Color.Gray,
                            fontSize = 12.sp,
                        )
                        buildClusterSubtitle(cluster).takeIf { it.isNotBlank() }?.let { subtitle ->
                            Spacer(modifier = Modifier.height(4.dp))
                            Text(
                                text = subtitle,
                                color = Color.Gray,
                                fontSize = 12.sp,
                            )
                        }
                        buildClusterAssignedTournamentDetail(cluster).takeIf { it.isNotBlank() }?.let { detail ->
                            Spacer(modifier = Modifier.height(6.dp))
                            Text(
                                text = detail,
                                color = MaterialTheme.colorScheme.onBackground.copy(alpha = 0.82f),
                                fontSize = 12.sp,
                            )
                        }
                        Spacer(modifier = Modifier.height(10.dp))
                        LazyColumn(
                            modifier = Modifier.fillMaxSize(),
                        ) {
                            items(
                                items = courts,
                                key = { court -> court.id.ifBlank { court.displayName() } },
                            ) { c ->
                                val livePresence = c.presence ?: c.liveScreenPresence
                                val courtOccupied = isPresenceEffectivelyOccupied(livePresence)
                                val subtitle = buildCourtSubtitle(c)
                                val trailingChip =
                                    if (courtOccupied) {
                                        presenceChipLabel(livePresence)
                                    } else {
                                        null
                                    }
                                SelectCard(
                                    title = c.displayName(),
                                    subtitle = subtitle,
                                    trailingChipText = trailingChip,
                                    onClick = {
                                        if (courtOccupied) {
                                            occupiedCourtMessage = buildOccupiedCourtMessage(c, livePresence)
                                            return@SelectCard
                                        }
                                        selectedCourt = c
                                        currentMatchId = null
                                        currentMatch = null
                                        step = AdminStep.COURT_MATCH
                                    },
                                )
                                Spacer(modifier = Modifier.height(10.dp))
                            }
                        }
                        Spacer(modifier = Modifier.height(8.dp))
                        TextButton(onClick = { step = AdminStep.CLUSTERS }) {
                            Text("Quay lại")
                        }
                    }
                }
                AdminStep.COURT_MATCH -> {
                    val c = selectedCourt
                    if (c == null) {
                        step = AdminStep.COURTS
                    } else {
                        val livePresence = c.presence ?: c.liveScreenPresence
                        val courtBlocked = isPresenceEffectivelyOccupied(livePresence)
                        Text(
                            text = c.displayName(),
                            color = Color.Gray,
                            fontSize = 12.sp,
                        )
                        Spacer(modifier = Modifier.height(12.dp))

                        val fallbackMatch =
                            buildPreferredCourtMatchSummary(c)?.takeIf { fallback ->
                                val fallbackId = fallback.id.takeIf { it.isNotBlank() }
                                !fallbackId.isNullOrBlank() && fallbackId == currentMatchId
                            }
                        val match = pickPreferredCourtMatch(currentMatch, fallbackMatch)
                        val mid =
                            match?.id?.takeIf { it.isNotBlank() }
                                ?: currentMatchId?.takeIf { it.isNotBlank() }

                        if (mid.isNullOrBlank()) {
                            Text(
                                text = "Sân đang không có trận hiện tại.",
                                color = Color.White,
                                fontSize = 14.sp,
                            )
                        } else if (match == null && matchLoadError == null) {
                            Text(
                                text = if (isMatchLoading) "Đang tải thông tin trận…" else "Đang tải thông tin trận…",
                                color = Color.White,
                                fontSize = 14.sp,
                            )
                        } else if (match == null) {
                            Text(
                                text = matchLoadError ?: "Không tải được thông tin trận.",
                                color = Color(0xFFFF6B6B),
                                fontSize = 13.sp,
                            )
                            Spacer(modifier = Modifier.height(6.dp))
                            Text(
                                text = "Bạn vẫn có thể bấm LIVE để vào chế độ live theo sân.",
                                color = Color.Gray,
                                fontSize = 12.sp,
                            )
                            Spacer(modifier = Modifier.height(6.dp))
                            TextButton(
                                onClick = {
                                    val m = mid?.trim().orEmpty()
                                    if (m.isBlank()) return@TextButton
                                    isMatchLoading = true
                                    matchLoadError = null
                                    scope.launch {
                                        repository.getMatchRuntime(m)
                                            .onSuccess { currentMatch = it; matchLoadError = null }
                                            .onFailure { matchLoadError = it.message ?: "Không tải được thông tin trận" }
                                        isMatchLoading = false
                                    }
                                },
                            ) {
                                Text("Tải lại")
                            }
                        } else {
                            val codeText =
                                (match.displayCode ?: match.code ?: match.roundLabel).orEmpty().ifBlank { "Trận hiện tại" }
                            Card(
                                modifier = Modifier.fillMaxWidth(),
                                shape = RoundedCornerShape(18.dp),
                                colors = CardDefaults.cardColors(
                                    containerColor = MaterialTheme.colorScheme.surface,
                                ),
                            ) {
                                Column(modifier = Modifier.padding(14.dp)) {
                                    Row(
                                        modifier = Modifier.fillMaxWidth(),
                                        horizontalArrangement = Arrangement.SpaceBetween,
                                        verticalAlignment = Alignment.CenterVertically,
                                    ) {
                                        CodeChip(codeText)
                                        StatusChip(match.status)
                                    }

                                    Spacer(modifier = Modifier.height(10.dp))

                                    Text(
                                        text = "${match.teamAName} vs ${match.teamBName}",
                                        fontWeight = FontWeight.SemiBold,
                                        fontSize = 16.sp,
                                    )

                                    Spacer(modifier = Modifier.height(8.dp))

                                    Row(
                                        modifier = Modifier.fillMaxWidth(),
                                        horizontalArrangement = Arrangement.SpaceBetween,
                                        verticalAlignment = Alignment.CenterVertically,
                                    ) {
                                        Text(
                                            text = "Tỉ số",
                                            color = LiveColors.TextSecondary,
                                            fontSize = 12.sp,
                                        )
                                        Text(
                                            text = "${match.scoreA} - ${match.scoreB}",
                                            fontWeight = FontWeight.SemiBold,
                                            color = MaterialTheme.colorScheme.primary,
                                            fontSize = 14.sp,
                                        )
                                    }
                                }
                            }
                        }

                        Spacer(modifier = Modifier.height(10.dp))

                        if (courtBlocked) {
                            Card(
                                modifier = Modifier.fillMaxWidth(),
                                colors = CardDefaults.cardColors(
                                    containerColor = Color(0xFF3A2914),
                                ),
                                shape = RoundedCornerShape(14.dp),
                            ) {
                                Column(modifier = Modifier.padding(12.dp)) {
                                    Text(
                                        text = "Sân đang được giữ bởi một thiết bị khác",
                                        color = Color.White,
                                        fontWeight = FontWeight.SemiBold,
                                        fontSize = 13.sp,
                                    )
                                    Spacer(modifier = Modifier.height(4.dp))
                                    Text(
                                        text = buildOccupiedCourtMessage(c, livePresence),
                                        color = Color.White.copy(alpha = 0.82f),
                                        fontSize = 12.sp,
                                    )
                                }
                            }
                            Spacer(modifier = Modifier.height(10.dp))
                        }

                        Button(
                            onClick = {
                                if (courtBlocked) {
                                    occupiedCourtMessage = buildOccupiedCourtMessage(c, livePresence)
                                    return@Button
                                }
                                if (isLaunchingLive) return@Button
                                isLaunchingLive = true
                                onStartLiveByCourt(c.id)
                            },
                            colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.primary),
                            modifier = Modifier.fillMaxWidth(),
                            enabled = !isLaunchingLive && !courtBlocked,
                        ) {
                            if (isLaunchingLive || courtBlocked) {
                                Text("Đang mở…")
                            } else {
                                Text("LIVE")
                            }
                        }

                        Spacer(modifier = Modifier.height(10.dp))
                        TextButton(onClick = { step = AdminStep.COURTS }) {
                            Text("Quay lại")
                        }
                    }
                }
            }
        }
    }

    if (showLogoutConfirm) {
        AlertDialog(
            onDismissRequest = { showLogoutConfirm = false },
            title = {
                Text(
                    text = "Đăng xuất",
                    fontWeight = FontWeight.SemiBold,
                )
            },
            text = {
                Text(
                    text = "Bạn có chắc muốn đăng xuất khỏi PickleTour Live không?",
                    fontSize = 14.sp,
                )
            },
            confirmButton = {
                Button(
                    onClick = {
                        showLogoutConfirm = false
                        onLogout()
                    },
                    colors = ButtonDefaults.buttonColors(
                        containerColor = Color(0xFFD64545),
                    ),
                ) {
                    Text("Đăng xuất")
                }
            },
            dismissButton = {
                TextButton(onClick = { showLogoutConfirm = false }) {
                    Text("Hủy")
                }
            },
        )
    }

    occupiedCourtMessage?.let { message ->
        AlertDialog(
            onDismissRequest = { occupiedCourtMessage = null },
            title = {
                Text(
                    text = "Sân đang được giữ",
                    fontWeight = FontWeight.SemiBold,
                )
            },
            text = {
                Text(
                    text = message,
                    fontSize = 14.sp,
                )
            },
            confirmButton = {
                TextButton(onClick = { occupiedCourtMessage = null }) {
                    Text("Đóng")
                }
            },
        )
    }
}

@Composable
private fun SelectCard(
    title: String,
    subtitle: String?,
    detailText: String? = null,
    trailingChipText: String? = null,
    onClick: () -> Unit,
) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick),
    ) {
        Row(
            modifier = Modifier.padding(14.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = title,
                    fontWeight = FontWeight.SemiBold,
                    fontSize = 15.sp,
                )
                subtitle?.takeIf { it.isNotBlank() }?.let {
                    Spacer(modifier = Modifier.height(4.dp))
                    Text(
                        text = it,
                        color = Color.Gray,
                        fontSize = 12.sp,
                    )
                }
                detailText?.takeIf { it.isNotBlank() }?.let {
                    Spacer(modifier = Modifier.height(6.dp))
                    Text(
                        text = it,
                        color = Color.White.copy(alpha = 0.88f),
                        fontSize = 12.sp,
                    )
                }
            }
            trailingChipText?.takeIf { it.isNotBlank() }?.let {
                LivePresenceChip(text = it)
            }
        }
    }
}

@Composable
private fun LivePresenceChip(text: String) {
    Text(
        text = text,
        modifier = Modifier
            .clip(RoundedCornerShape(999.dp))
            .background(Color(0xFF5B4A1F))
            .padding(horizontal = 12.dp, vertical = 6.dp),
        color = Color.White,
        fontSize = 11.sp,
        fontWeight = FontWeight.Bold,
    )
}

private fun extractId(v: JsonElement?): String? {
    if (v == null) return null
    return when {
        v is JsonPrimitive && v.isString -> v.asString.takeIf { it.isNotBlank() }
        v is JsonObject -> v.getAsJsonPrimitive("_id")?.asString?.takeIf { it.isNotBlank() }
            ?: v.getAsJsonPrimitive("id")?.asString?.takeIf { it.isNotBlank() }
        v.isJsonPrimitive && v.asJsonPrimitive.isString -> v.asString.takeIf { it.isNotBlank() }
        v.isJsonObject -> v.asJsonObject.getAsJsonPrimitive("_id")?.asString?.takeIf { it.isNotBlank() }
            ?: v.asJsonObject.getAsJsonPrimitive("id")?.asString?.takeIf { it.isNotBlank() }
        else -> null
    }
}

private fun jsonObjectOf(raw: JsonElement?): JsonObject? {
    if (raw == null) return null
    return when {
        raw is JsonObject -> raw
        raw.isJsonObject -> raw.asJsonObject
        else -> null
    }
}

private fun JsonObject.getStringOrNull(key: String): String? {
    val value = get(key) ?: return null
    if (value.isJsonNull) return null
    return runCatching { value.asString?.trim() }.getOrNull()?.takeIf { it.isNotBlank() }
}

private fun JsonObject.getIntOrNull(key: String): Int? {
    val value = get(key) ?: return null
    if (value.isJsonNull) return null
    return runCatching { value.asInt }.getOrNull()
}

private fun JsonObject.getObjectOrNull(key: String): JsonObject? {
    val value = get(key) ?: return null
    if (value.isJsonNull || !value.isJsonObject) return null
    return value.asJsonObject
}

private fun buildCourtCurrentMatchSummary(raw: JsonElement?): MatchData? {
    val obj = jsonObjectOf(raw) ?: return null
    val matchId =
        obj.getStringOrNull("_id")
            ?: obj.getStringOrNull("id")
            ?: return null
    val pairA = obj.getObjectOrNull("pairA")
    val pairB = obj.getObjectOrNull("pairB")
    val score = obj.getObjectOrNull("score")
    val tournament = obj.getObjectOrNull("tournament")
    val bracket = obj.getObjectOrNull("bracket")

    return MatchData(
        id = matchId,
        code = obj.getStringOrNull("code") ?: obj.getStringOrNull("labelKey"),
        displayCode =
            obj.getStringOrNull("displayCode")
                ?: obj.getStringOrNull("globalCode")
                ?: obj.getStringOrNull("labelKey"),
        teamAName = pairA?.getStringOrNull("name") ?: obj.getStringOrNull("teamAName").orEmpty(),
        teamBName = pairB?.getStringOrNull("name") ?: obj.getStringOrNull("teamBName").orEmpty(),
        scoreA = score?.getIntOrNull("a") ?: 0,
        scoreB = score?.getIntOrNull("b") ?: 0,
        status = obj.getStringOrNull("status").orEmpty(),
        tournamentName = tournament?.getStringOrNull("name").orEmpty(),
        courtName =
            obj.getStringOrNull("courtStationName")
                ?: obj.getStringOrNull("courtLabel")
                ?: obj.getStringOrNull("courtClusterName")
                ?: "",
        stageName = obj.getStringOrNull("stageName")
            ?: bracket?.getStringOrNull("name").orEmpty(),
        roundLabel = obj.getStringOrNull("roundLabel")
            ?: obj.getStringOrNull("labelKey").orEmpty(),
        courtStationId = obj.getStringOrNull("courtStationId"),
        courtStationName = obj.getStringOrNull("courtStationName") ?: obj.getStringOrNull("courtLabel"),
        courtClusterId = obj.getStringOrNull("courtClusterId"),
        courtClusterName = obj.getStringOrNull("courtClusterName"),
    )
}

private fun normalizedCourtMatchStatus(value: String?): String =
    value?.trim()?.lowercase(Locale.ROOT).orEmpty()

private fun isTerminalCourtMatchStatus(value: String?): Boolean =
    when (normalizedCourtMatchStatus(value)) {
        "ended", "finished", "completed", "done", "closed", "final", "cancelled", "canceled" -> true
        else -> false
    }

private fun courtMatchStatusPriority(value: String?): Int =
    when (normalizedCourtMatchStatus(value)) {
        "live" -> 0
        "assigned" -> 1
        "scheduled" -> 2
        "queued" -> 3
        else -> 9
    }

private fun isLiveCourtMatchStatus(value: String?): Boolean =
    normalizedCourtMatchStatus(value) == "live"

private fun pickPreferredCourtMatch(vararg matches: MatchData?): MatchData? =
    matches
        .filterNotNull()
        .filterNot { isPlaceholderMatch(it) }
        .filter { isLiveCourtMatchStatus(it.status) }
        .firstOrNull()

private fun matchIdentity(match: MatchData?): String? = match?.id?.trim()?.takeIf { it.isNotBlank() }

private fun isMeaningfulTeamLabel(value: String?): Boolean {
    val normalized = value?.trim().orEmpty()
    if (normalized.isBlank()) return false
    return !normalized.equals("Team A", ignoreCase = true) &&
        !normalized.equals("Team B", ignoreCase = true)
}

private fun mergeCourtMatchDetails(primary: MatchData?, fallback: MatchData?): MatchData? {
    if (primary == null) return fallback
    if (fallback == null) return primary

    val primaryId = matchIdentity(primary)
    val fallbackId = matchIdentity(fallback)
    if (!primaryId.isNullOrBlank() && !fallbackId.isNullOrBlank() && primaryId != fallbackId) {
        return primary
    }

    val shouldPreserveFallbackScore =
        primary.liveVersion == null &&
            fallback.liveVersion != null &&
            primary.scoreA == 0 &&
            primary.scoreB == 0 &&
            (fallback.scoreA != 0 || fallback.scoreB != 0)

    return primary.copy(
        code = primary.code?.takeIf { it.isNotBlank() } ?: fallback.code,
        displayCode =
            primary.displayCode?.takeIf { it.isNotBlank() }
                ?: fallback.displayCode
                ?: fallback.code
                ?: fallback.roundLabel.takeIf { it.isNotBlank() },
        teamAName = if (isMeaningfulTeamLabel(primary.teamAName)) primary.teamAName else fallback.teamAName,
        teamBName = if (isMeaningfulTeamLabel(primary.teamBName)) primary.teamBName else fallback.teamBName,
        scoreA = if (shouldPreserveFallbackScore) fallback.scoreA else primary.scoreA,
        scoreB = if (shouldPreserveFallbackScore) fallback.scoreB else primary.scoreB,
        serveSide = primary.serveSide.takeIf { it.isNotBlank() } ?: fallback.serveSide,
        serveCount = if (primary.serveCount > 0) primary.serveCount else fallback.serveCount,
        status = primary.status.takeIf { it.isNotBlank() } ?: fallback.status,
        tournamentName = primary.tournamentName.takeIf { it.isNotBlank() } ?: fallback.tournamentName,
        courtName = primary.courtName.takeIf { it.isNotBlank() } ?: fallback.courtName,
        tournamentLogoUrl = primary.tournamentLogoUrl ?: fallback.tournamentLogoUrl,
        stageName = primary.stageName.takeIf { it.isNotBlank() } ?: fallback.stageName,
        phaseText = primary.phaseText.takeIf { it.isNotBlank() } ?: fallback.phaseText,
        roundLabel = primary.roundLabel.takeIf { it.isNotBlank() } ?: fallback.roundLabel,
        seedA = primary.seedA ?: fallback.seedA,
        seedB = primary.seedB ?: fallback.seedB,
        isBreak = primary.isBreak ?: fallback.isBreak,
        breakNote = primary.breakNote.takeIf { it.isNotBlank() } ?: fallback.breakNote,
        sets = primary.sets ?: fallback.sets,
        gameScores = primary.gameScores ?: fallback.gameScores,
        video = primary.video ?: fallback.video,
        courtStationId = primary.courtStationId ?: fallback.courtStationId,
        courtStationName =
            primary.courtStationName?.takeIf { it.isNotBlank() } ?: fallback.courtStationName,
        courtClusterId = primary.courtClusterId ?: fallback.courtClusterId,
        courtClusterName =
            primary.courtClusterName?.takeIf { it.isNotBlank() } ?: fallback.courtClusterName,
        tournament = primary.tournament ?: fallback.tournament,
        court = primary.court ?: fallback.court,
    )
}

private fun resolveCurrentCourtMatch(
    incoming: MatchData?,
    fallback: MatchData?,
    existing: MatchData?,
): MatchData? {
    val resolvedId = matchIdentity(incoming) ?: matchIdentity(fallback) ?: matchIdentity(existing)
    if (resolvedId.isNullOrBlank()) {
        return pickPreferredCourtMatch(incoming, fallback, existing)
    }

    val candidates =
        listOf(incoming, fallback, existing)
            .filterNotNull()
            .filter { candidate ->
                val candidateId = matchIdentity(candidate)
                candidateId.isNullOrBlank() || candidateId == resolvedId
            }
    if (candidates.isEmpty()) return null

    val merged =
        candidates.drop(1).fold(candidates.first()) { acc, candidate ->
            mergeCourtMatchDetails(acc, candidate) ?: acc
        }

    return if (isLiveCourtMatchStatus(merged.status) && !isPlaceholderMatch(merged)) {
        merged
    } else {
        pickPreferredCourtMatch(merged, fallback, existing)
    }
}

private fun buildPreferredCourtMatchSummary(court: AdminCourtData?): MatchData? {
    if (court == null) return null
    val current = buildCourtCurrentMatchSummary(court.currentMatch)
    val nextQueued = buildCourtCurrentMatchSummary(court.nextQueuedMatch)
    val queueMatches =
        court.queueItems.asSequence()
            .mapNotNull { item -> buildCourtCurrentMatchSummary(item.match) }
            .toList()
    return pickPreferredCourtMatch(current, nextQueued, *queueMatches.toTypedArray())
}

private fun isPlaceholderMatch(match: MatchData?): Boolean {
    if (match == null) return true
    val teamA = match.teamAName.trim()
    val teamB = match.teamBName.trim()
    val hasPlaceholderTeams =
        (teamA.isBlank() || teamA.equals("Team A", ignoreCase = true)) &&
            (teamB.isBlank() || teamB.equals("Team B", ignoreCase = true))
    val hasMeaningfulCode =
        !match.displayCode.isNullOrBlank() ||
            !match.code.isNullOrBlank() ||
            !match.roundLabel.isBlank()
    return hasPlaceholderTeams && !hasMeaningfulCode
}

private fun parseIsoEpochMillis(raw: String?): Long? {
    val value = raw?.trim().orEmpty()
    if (value.isBlank()) return null
    val patterns =
        listOf(
            "yyyy-MM-dd'T'HH:mm:ss.SSSX",
            "yyyy-MM-dd'T'HH:mm:ssX",
            "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",
            "yyyy-MM-dd'T'HH:mm:ss'Z'",
        )
    for (pattern in patterns) {
        runCatching {
            val parser = SimpleDateFormat(pattern, Locale.US)
            parser.parse(value)?.time
        }.getOrNull()?.let { return it }
    }
    return runCatching { value.toLong() }.getOrNull()
}

private fun isPresenceEffectivelyOccupied(presence: CourtLiveScreenPresence?): Boolean {
    if (presence?.occupied != true) return false
    val now = System.currentTimeMillis()
    val expiresAt = parseIsoEpochMillis(presence.expiresAt)
    if (expiresAt != null && expiresAt <= now) return false

    val screenState = presence.screenState?.trim()?.lowercase().orEmpty()
    val previewLike =
        screenState == "preview" ||
            screenState == "waiting_for_court" ||
            screenState == "waiting_for_next_match" ||
            screenState == "idle" ||
            screenState == "preview_unknown"
    if (previewLike) {
        val previewReleaseAt = parseIsoEpochMillis(presence.previewReleaseAt)
        if (previewReleaseAt != null && previewReleaseAt <= now) return false
    }

    return true
}

private fun presenceChipLabel(presence: CourtLiveScreenPresence?): String {
    val screenState = presence?.screenState?.trim()?.lowercase().orEmpty()
    return when (screenState) {
        "live" -> "Đang live"
        "preview", "preview_unknown" -> "Đang preview"
        "waiting_for_court", "waiting_for_next_match", "idle" -> "Đang giữ"
        else -> "Đang bận"
    }
}

private fun buildOccupiedCourtMessage(
    court: AdminCourtData,
    presence: CourtLiveScreenPresence?,
): String {
    if (presence == null || !presence.occupied) {
        return "${court.displayName()} đang được giữ trên một thiết bị khác."
    }
    val stateText =
        when (presence.screenState?.trim()?.lowercase()) {
            "live" -> "Thiết bị khác đang LIVE trên sân này."
            "connecting", "reconnecting", "starting_countdown" ->
                "Thiết bị khác đang chuẩn bị phát hoặc đang kết nối stream."
            else -> "Thiết bị khác đang ở màn live/preview của sân này."
        }
    val releaseText =
        formatPresenceReleaseTime(presence.previewReleaseAt)?.let {
            " Nếu máy kia chỉ ở preview quá lâu, sân dự kiến sẽ tự động được trả lúc $it."
        }.orEmpty()
    return "${court.displayName()} đang được giữ. $stateText$releaseText"
}

private fun formatPresenceReleaseTime(raw: String?): String? {
    val value = raw?.trim().orEmpty()
    if (value.isBlank()) return null
    val formats =
        listOf(
            "yyyy-MM-dd'T'HH:mm:ss.SSSX",
            "yyyy-MM-dd'T'HH:mm:ssX",
            "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",
            "yyyy-MM-dd'T'HH:mm:ss'Z'",
        )
    for (pattern in formats) {
        runCatching {
            val parser = SimpleDateFormat(pattern, Locale.US)
            val parsed = parser.parse(value) ?: return@runCatching null
            val formatter = SimpleDateFormat("HH:mm", Locale.getDefault())
            formatter.format(parsed)
        }.getOrNull()?.let { return it }
    }
    return runCatching {
        val millis = value.toLong()
        val formatter = SimpleDateFormat("HH:mm", Locale.getDefault())
        formatter.format(Date(millis))
    }.getOrNull()
}

private fun buildClusterSubtitle(cluster: CourtClusterData): String {
    val venue = cluster.venueName?.trim().orEmpty()
    if (venue.isNotBlank()) return venue
    return cluster.description?.trim().orEmpty()
}

private fun buildClusterAssignedTournamentDetail(cluster: CourtClusterData): String {
    val tournaments =
        cluster.assignedTournaments.filter { it.displayName().isNotBlank() }
    if (tournaments.isEmpty()) {
        return "Giải đang gán: chưa có giải nào."
    }
    val preview =
        tournaments.take(3).joinToString("\n") { tournament ->
            val meta =
                listOf(
                    tournamentStatusLabel(tournament.status),
                    tournamentEventTypeLabel(tournament.eventType),
                ).filter { it.isNotBlank() }
                    .joinToString(" • ")
            if (meta.isBlank()) {
                "• ${tournament.displayName()}"
            } else {
                "• ${tournament.displayName()} ($meta)"
            }
        }
    val suffix = if (tournaments.size > 3) "\n+${tournaments.size - 3} giải khác" else ""
    return "Giải đang gán:\n$preview$suffix"
}

private fun buildClusterTrailingChip(cluster: CourtClusterData): String {
    val assignedCount = cluster.assignedTournamentCount ?: cluster.assignedTournaments.size
    val stationsCount = cluster.stationsCount ?: 0
    val liveCount = cluster.liveCount ?: 0
    return when {
        assignedCount > 0 -> "$assignedCount giải"
        liveCount > 0 -> "$liveCount live"
        stationsCount > 0 -> "$stationsCount sân"
        else -> "Cụm sân"
    }
}

private fun tournamentStatusLabel(raw: String?): String {
    return when (raw?.trim()?.lowercase(Locale.ROOT)) {
        "live", "ongoing", "running", "active" -> "đang diễn ra"
        "finished", "completed", "closed" -> "đã kết thúc"
        "published", "open" -> "đang mở"
        "draft" -> "nháp"
        else -> ""
    }
}

private fun tournamentEventTypeLabel(raw: String?): String {
    return when (raw?.trim()?.lowercase(Locale.ROOT)) {
        "single" -> "đơn"
        "double" -> "đôi"
        "team" -> "đồng đội"
        "double_elim", "doubleelim" -> "double elim"
        else -> ""
    }
}

private fun courtModeLabel(raw: String?): String {
    return when (raw?.trim()?.lowercase()) {
        "queue" -> "Danh sách"
        else -> "Gán tay"
    }
}

private fun buildCourtSubtitle(court: AdminCourtData): String {
    val parts = mutableListOf<String>()
    court.code?.takeIf { it.isNotBlank() }?.let(parts::add)
    parts.add(courtModeLabel(court.assignmentMode))
    matchCodeFromJson(court.currentMatch)?.let { parts.add("Đang: $it") }
    if (court.queueCount > 0) {
        matchCodeFromJson(court.nextQueuedMatch)?.let { parts.add("Tiếp: $it") }
            ?: parts.add("${court.queueCount} trận chờ")
    }
    return parts.joinToString(" • ")
}

private fun matchCodeFromJson(raw: JsonElement?): String? {
    if (raw == null) return null
    return when {
        raw is JsonObject ->
            raw.get("displayCode")?.takeIf { !it.isJsonNull }?.asString?.takeIf { it.isNotBlank() }
                ?: raw.get("code")?.takeIf { !it.isJsonNull }?.asString?.takeIf { it.isNotBlank() }
                ?: raw.get("globalCode")?.takeIf { !it.isJsonNull }?.asString?.takeIf { it.isNotBlank() }
                ?: raw.get("labelKey")?.takeIf { !it.isJsonNull }?.asString?.takeIf { it.isNotBlank() }
        raw.isJsonObject -> {
            val obj = raw.asJsonObject
            obj.get("displayCode")?.takeIf { !it.isJsonNull }?.asString?.takeIf { it.isNotBlank() }
                ?: obj.get("code")?.takeIf { !it.isJsonNull }?.asString?.takeIf { it.isNotBlank() }
                ?: obj.get("globalCode")?.takeIf { !it.isJsonNull }?.asString?.takeIf { it.isNotBlank() }
                ?: obj.get("labelKey")?.takeIf { !it.isJsonNull }?.asString?.takeIf { it.isNotBlank() }
        }
        else -> null
    }
}

@Composable
private fun CodeChip(text: String) {
    Text(
        text = text,
        modifier = Modifier
            .clip(RoundedCornerShape(999.dp))
            .background(MaterialTheme.colorScheme.surfaceVariant)
            .padding(horizontal = 10.dp, vertical = 6.dp),
        color = Color.White,
        fontSize = 12.sp,
        fontWeight = FontWeight.SemiBold,
    )
}

@Composable
private fun StatusChip(status: String) {
    val label = viMatchStatus(status)
    val bg = statusColor(status)
    Text(
        text = label,
        modifier = Modifier
            .clip(RoundedCornerShape(999.dp))
            .background(bg)
            .padding(horizontal = 10.dp, vertical = 6.dp),
        color = Color.White,
        fontSize = 12.sp,
        fontWeight = FontWeight.SemiBold,
    )
}

private fun viMatchStatus(raw: String): String {
    return when (raw.trim().lowercase()) {
        "scheduled" -> "Chưa xếp"
        "queued" -> "Trong hàng đợi"
        "assigned" -> "Đã gán sân"
        "live" -> "Đang thi đấu"
        "finished" -> "Đã kết thúc"
        "idle" -> "Chờ"
        else -> raw.trim().ifBlank { "—" }
    }
}

private fun statusColor(raw: String): Color {
    return when (raw.trim().lowercase()) {
        "live" -> LiveColors.LiveRed
        "finished" -> LiveColors.AccentGreen
        "assigned" -> LiveColors.AccentBlue
        "queued" -> Color(0xFF06B6D4)
        else -> Color(0xFF64748B)
    }
}

package com.pkt.live.ui.overlay

import android.graphics.Color as AColor
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.pkt.live.data.model.OverlayData
import com.pkt.live.util.normalizeOverlayNameStyle
import com.pkt.live.util.overlayTeamNameCandidates

/**
 * Scoreboard overlay — faithful replica of old ScoreOverlayView.kt DefaultV2 design.
 *
 * Structure:
 * ┌─────── White top bar ───────┐
 * │ TOURNAMENT NAME (centered)  │
 * ├─────── Black mid row ───────┤
 * │ [Seed] Name A  ●● │ ScoreA │
 * │ [Seed] Name B  ●● │ ─────  │
 * │                    │ ScoreB │
 * ├─────── White bottom bar ────┤
 * │ STAGE NAME (centered)       │
 * └─────────────────────────────┘
 */

private val V2_GREEN_SCORE = Color(0xFF41935D)
private val V2_SERVE_GREEN = Color(0xFF22C55E)
private val V2_SERVE_GREY = Color(0xFF4B5563)
private val V2_DIVIDER = Color(0x4DFFFFFF) // 30% white

@Composable
fun ScoreboardOverlay(
    data: OverlayData,
    modifier: Modifier = Modifier,
) {
    if (!data.overlayEnabled) return

    if (data.isBreak) {
        BreakCard(data, modifier)
        return
    }

    // V2 scoreboard
    Column(
        modifier = modifier
            .width(220.dp)
            .clip(RoundedCornerShape(6.dp)),
    ) {
        // ── Top white bar: Tournament name ──
        val topTitle = data.tournamentName.ifBlank { "GIẢI PICKLEBALL" }.uppercase()
        Text(
            text = topTitle,
            color = Color.Black,
            fontSize = 10.sp,
            fontWeight = FontWeight.Bold,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            textAlign = TextAlign.Center,
            modifier = Modifier
                .fillMaxWidth()
                .background(Color.White)
                .padding(horizontal = 8.dp, vertical = 3.dp),
        )

        Spacer(modifier = Modifier.height(1.dp))

        // ── Black mid row: Names + Scores ──
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(Color.Black)
                .padding(start = 6.dp, top = 3.dp, bottom = 3.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            // Names column (grows)
            Column(
                modifier = Modifier.weight(1f),
            ) {
                // Team A row
                V2TeamRow(
                    name = data.teamAName,
                    seed = data.seedA,
                    isServing = data.serveSide == "A",
                    serveCount = data.serveCount,
                    overlayNameStyle = data.overlayNameStyle,
                )
                Spacer(modifier = Modifier.height(1.dp))
                // Team B row
                V2TeamRow(
                    name = data.teamBName,
                    seed = data.seedB,
                    isServing = data.serveSide == "B",
                    serveCount = data.serveCount,
                    overlayNameStyle = data.overlayNameStyle,
                )
            }

            // Score column (green background)
            Column(
                modifier = Modifier
                    .width(34.dp)
                    .background(V2_GREEN_SCORE),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                // Score A
                Text(
                    text = data.scoreA.toString(),
                    color = Color.White,
                    fontSize = 18.sp,
                    fontWeight = FontWeight.Bold,
                    textAlign = TextAlign.Center,
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(vertical = 3.dp),
                )
                // Divider
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(1.dp)
                        .background(V2_DIVIDER),
                )
                // Score B
                Text(
                    text = data.scoreB.toString(),
                    color = Color.White,
                    fontSize = 18.sp,
                    fontWeight = FontWeight.Bold,
                    textAlign = TextAlign.Center,
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(vertical = 3.dp),
                )
            }
        }

        // ── Bottom white bar: Stage name ──
        if (data.stageName.isNotBlank()) {
            Spacer(modifier = Modifier.height(1.dp))
            Text(
                text = data.stageName.uppercase(),
                color = Color.Black,
                fontSize = 10.sp,
                fontWeight = FontWeight.Bold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                textAlign = TextAlign.Center,
                modifier = Modifier
                    .fillMaxWidth()
                    .background(Color.White)
                    .padding(horizontal = 8.dp, vertical = 3.dp),
            )
        }
    }
}

@Composable
private fun V2TeamRow(
    name: String,
    seed: Int?,
    isServing: Boolean,
    serveCount: Int,
    overlayNameStyle: String,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 1.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        // Seed
        if (seed != null && seed > 0) {
            Text(
                text = seed.toString(),
                color = Color.White,
                fontSize = 9.sp,
            )
            Spacer(modifier = Modifier.width(3.dp))
        }

        // Team name
        BoxWithConstraints(modifier = Modifier.weight(1f)) {
            val fitted = fitComposeTeamName(
                rawName = name,
                style = overlayNameStyle,
                maxWidthDp = maxWidth.value,
            )
            Text(
                text = fitted.text,
                color = Color.White,
                fontSize = fitted.fontSizeSp.sp,
                fontWeight = FontWeight.Bold,
                maxLines = 1,
                softWrap = false,
                overflow = TextOverflow.Visible,
            )
        }

        // Serve dots
        Spacer(modifier = Modifier.width(3.dp))
        Row(
            modifier = Modifier.width(18.dp),
            horizontalArrangement = Arrangement.Start,
        ) {
            if (isServing) {
                Box(
                    modifier = Modifier
                        .size(6.dp)
                        .clip(CircleShape)
                        .background(V2_SERVE_GREEN),
                )
                if (serveCount >= 2) {
                    Spacer(modifier = Modifier.width(2.dp))
                    Box(
                        modifier = Modifier
                            .size(6.dp)
                            .clip(CircleShape)
                            .background(V2_SERVE_GREEN),
                    )
                }
            }
        }
    }
}

private fun fitComposeTeamName(
    rawName: String,
    style: String,
    maxWidthDp: Float,
): ComposeTeamNameFit {
    val normalizedStyle = normalizeOverlayNameStyle(style)
    val candidates = overlayTeamNameCandidates(rawName, normalizedStyle)
    val sizes = if (normalizedStyle == "2") {
        listOf(12, 11, 10, 9, 8, 7)
    } else {
        listOf(12, 11, 10, 9, 8)
    }
    for (candidate in candidates) {
        for (fontSize in sizes) {
            if (estimatedTextWidthDp(candidate, fontSize) <= maxWidthDp) {
                return ComposeTeamNameFit(candidate, fontSize)
            }
        }
    }
    return ComposeTeamNameFit(
        text = candidates.lastOrNull().orEmpty().ifBlank { rawName.trim() },
        fontSizeSp = 8,
    )
}

private fun estimatedTextWidthDp(text: String, fontSizeSp: Int): Float {
    val weightedLength =
        text.sumOf { ch ->
            when {
                ch == ' ' -> 0.35
                ch == '/' -> 0.45
                ch.code < 128 -> 0.55
                else -> 0.62
            }
        }
    return (weightedLength * fontSizeSp).toFloat()
}

private data class ComposeTeamNameFit(
    val text: String,
    val fontSizeSp: Int,
)

@Composable
private fun BreakCard(
    data: OverlayData,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier
            .width(280.dp)
            .clip(RoundedCornerShape(6.dp))
            .background(Color(0xE61A1A1A))
            .padding(12.dp),
    ) {
        // Top: tournament + court
        if (data.tournamentName.isNotBlank()) {
            Text(
                text = data.tournamentName,
                color = Color(0xFF9AA4AF),
                fontSize = 11.sp,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        if (data.courtName.isNotBlank()) {
            Text(
                text = "Sân: ${data.courtName}",
                color = Color(0xFF9AA4AF),
                fontSize = 11.sp,
            )
        }

        Spacer(modifier = Modifier.height(4.dp))

        // Title
        Text(
            text = "ĐANG TẠM NGHỈ",
            color = Color.White,
            fontSize = 16.sp,
            fontWeight = FontWeight.Bold,
        )
        Text(
            text = "Chờ trọng tài bắt đầu game tiếp theo...",
            color = Color(0xFF9AA4AF),
            fontSize = 11.sp,
        )

        // Break note
        if (data.breakNote.isNotBlank()) {
            Text(
                text = data.breakNote,
                color = Color(0xFF9AA4AF),
                fontSize = 11.sp,
            )
        }

        Spacer(modifier = Modifier.height(4.dp))

        // Teams + Round
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                text = "${data.teamAName} vs ${data.teamBName}",
                color = Color.White,
                fontSize = 11.sp,
            )
            if (data.roundLabel.isNotBlank() || data.phaseText.isNotBlank()) {
                Spacer(modifier = Modifier.width(6.dp))
                Text(
                    text = (data.roundLabel.ifBlank { data.phaseText }),
                    color = Color.White,
                    fontSize = 10.sp,
                    modifier = Modifier
                        .clip(RoundedCornerShape(4.dp))
                        .background(Color(0xFF1F2937))
                        .padding(horizontal = 6.dp, vertical = 2.dp),
                )
            }
        }
    }
}

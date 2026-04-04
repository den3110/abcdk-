package com.pkt.live.ui.overlay

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import coil.request.ImageRequest
import coil.size.Size

/**
 * Sponsor logo bar displayed below the scoreboard.
 *
 * Anti-crash / RAM optimization:
 * - Images downsampled to max 120x56px (no full-res loading)
 * - Max 5 sponsors displayed
 * - Coil handles caching + lifecycle automatically
 */
@Composable
fun SponsorBar(
    sponsorLogos: List<String>,
    modifier: Modifier = Modifier,
) {
    if (sponsorLogos.isEmpty()) return

    val context = LocalContext.current

    Row(
        modifier = modifier.padding(horizontal = 8.dp, vertical = 4.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        sponsorLogos.take(5).forEach { url ->
            AsyncImage(
                model = ImageRequest.Builder(context)
                    .data(url)
                    .size(120, 56) // Downsample to exact display size — saves RAM
                    .crossfade(true)
                    .memoryCacheKey(url) // Stable cache key
                    .build(),
                contentDescription = "Sponsor",
                modifier = Modifier
                    .height(28.dp)
                    .widthIn(max = 60.dp)
                    .padding(horizontal = 4.dp)
                    .clip(RoundedCornerShape(4.dp)),
                contentScale = ContentScale.Fit,
            )
        }
    }
}

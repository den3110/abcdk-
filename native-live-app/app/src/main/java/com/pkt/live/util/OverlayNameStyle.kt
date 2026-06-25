package com.pkt.live.util

fun normalizeOverlayNameStyle(value: String?): String {
    val text = value?.trim().orEmpty()
    return if (text in setOf("1", "2", "3", "4")) text else "1"
}

fun overlayTeamNameCandidates(
    rawName: String,
    style: String,
): List<String> {
    val normalizedStyle = normalizeOverlayNameStyle(style)
    val base = normalizeTeamSeparator(rawName)
    val firstTokenShort = abbreviateTeamName(base, aggressive = false)
    val compactShort = abbreviateTeamName(base, aggressive = true)
    val candidates =
        when (normalizedStyle) {
            "2" -> listOf(base)
            "3" -> listOf(firstTokenShort, compactShort, base)
            "4" -> listOf(compactShort, firstTokenShort, base)
            else -> listOf(base, firstTokenShort, compactShort)
        }
    return candidates
        .map { it.trim() }
        .filter { it.isNotBlank() }
        .distinct()
}

private fun normalizeTeamSeparator(value: String): String =
    value
        .trim()
        .replace(Regex("\\s*&\\s*"), " / ")
        .replace(Regex("\\s*/\\s*"), " / ")
        .replace(Regex("\\s{2,}"), " ")

private fun abbreviateTeamName(
    value: String,
    aggressive: Boolean,
): String {
    return value
        .split(Regex("\\s*/\\s*"))
        .joinToString(" / ") { playerName ->
            abbreviatePlayerName(playerName, aggressive = aggressive)
        }
}

private fun abbreviatePlayerName(
    value: String,
    aggressive: Boolean,
): String {
    val parts = value.trim().split(Regex("\\s+")).filter { it.isNotBlank() }
    if (parts.size <= 1) return value.trim()
    if (!aggressive) {
        return listOf(tokenInitial(parts.first()), *parts.drop(1).toTypedArray())
            .joinToString(" ")
    }
    return parts
        .mapIndexed { index, token ->
            if (index == parts.lastIndex) token else tokenInitial(token)
        }
        .joinToString(" ")
}

private fun tokenInitial(token: String): String {
    val firstCodePoint = token.codePointAt(0)
    return String(Character.toChars(firstCodePoint)).uppercase()
}

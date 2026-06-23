package com.pkt.live.util

import com.google.gson.JsonArray
import com.google.gson.JsonObject

private fun JsonObject?.safeStr(key: String): String? =
    if (this != null && has(key) && !get(key).isJsonNull) {
        runCatching { get(key).asString?.trim() }.getOrNull()?.takeIf { it.isNotBlank() }
    } else {
        null
    }

private fun JsonObject?.safeObj(key: String): JsonObject? =
    if (this != null && has(key) && get(key).isJsonObject) getAsJsonObject(key) else null

private fun JsonObject?.safeArr(key: String): JsonArray? =
    if (this != null && has(key) && get(key).isJsonArray) getAsJsonArray(key) else null

private fun firstNotBlank(vararg values: String?): String? =
    values.firstOrNull { !it.isNullOrBlank() }?.trim()

private fun isReferenceDisplayName(value: String?): Boolean {
    val normalized =
        value
            ?.trim()
            ?.replace(Regex("\\s+"), "")
            ?.replace(Regex("\\([AB]\\)$", RegexOption.IGNORE_CASE), "")
            .orEmpty()
    if (normalized.isBlank()) return false
    return Regex("^(?:[WL]-)?V\\d+(?:-[A-Z0-9]+)?(?:-NT)?-T\\d+$", RegexOption.IGNORE_CASE)
        .matches(normalized) ||
        Regex("^(?:WB|LB)\\d+-T\\d+$", RegexOption.IGNORE_CASE).matches(normalized) ||
        Regex("^GF(?:\\d+)?-T\\d+$", RegexOption.IGNORE_CASE).matches(normalized)
}

private fun isUsefulSideDisplayName(value: String?): Boolean {
    val text = value?.trim().orEmpty()
    if (text.isBlank()) return false
    if (
        Regex("^(TBD|Registration|Chưa có đội|Đội A|Đội B|Team A|Team B|—|-)$", RegexOption.IGNORE_CASE)
            .matches(text)
    ) {
        return false
    }
    return !isReferenceDisplayName(text)
}

private fun sideKeyOf(side: String): String = if (side.uppercase() == "B") "B" else "A"

fun resolveMatchDisplayMode(match: JsonObject?): String {
    val raw =
        firstNotBlank(
            match.safeStr("displayNameMode"),
            match.safeStr("nameDisplayMode"),
            match.safeObj("tournament").safeStr("displayNameMode"),
            match.safeObj("tournament").safeStr("nameDisplayMode"),
        )
    return if (raw == "fullName") "fullName" else "nickname"
}

fun resolvePlayerNickname(player: JsonObject?): String? =
    firstNotBlank(
        player.safeStr("nickname"),
        player.safeStr("nickName"),
        player.safeObj("user").safeStr("nickname"),
        player.safeObj("user").safeStr("nickName"),
    )

fun resolvePlayerFullName(player: JsonObject?): String? =
    firstNotBlank(
        player.safeStr("fullName"),
        player.safeStr("name"),
        player.safeObj("user").safeStr("fullName"),
        player.safeObj("user").safeStr("name"),
        player.safeStr("shortName"),
        resolvePlayerNickname(player),
    )

fun resolvePlayerDisplayName(
    player: JsonObject?,
    displayMode: String = "nickname",
): String? {
    val explicit = player.safeStr("displayName")
    if (!explicit.isNullOrBlank()) return explicit

    val nickname = resolvePlayerNickname(player)
    val fullName = resolvePlayerFullName(player)
    return if (displayMode == "fullName") {
        firstNotBlank(fullName, nickname)
    } else {
        firstNotBlank(nickname, player.safeStr("shortName"), fullName)
    }
}

fun resolvePairDisplayName(
    pair: JsonObject?,
    displayMode: String = "nickname",
): String? {
    val joinedPlayers =
        listOf(
            resolvePlayerDisplayName(pair.safeObj("player1"), displayMode),
            resolvePlayerDisplayName(pair.safeObj("player2"), displayMode),
        ).filter { !it.isNullOrBlank() }

    if (joinedPlayers.isNotEmpty()) {
        return joinedPlayers.joinToString(" / ")
    }

    return firstNotBlank(
        pair.safeStr("displayName"),
        pair.safeStr("teamName"),
        pair.safeStr("teamFactionName"),
        pair.safeStr("label"),
        pair.safeStr("title"),
        pair.safeStr("name"),
    )
}

fun resolveTeamDisplayName(
    team: JsonObject?,
    displayMode: String = "nickname",
): String? {
    team.safeStr("displayName")?.let { return it }

    val players =
        team.safeArr("players")
            ?.mapNotNull { element ->
                if (element.isJsonObject) {
                    resolvePlayerDisplayName(element.asJsonObject, displayMode)
                } else {
                    null
                }
            }
            ?.filter { !it.isNullOrBlank() }
            .orEmpty()

    if (players.isNotEmpty()) return players.joinToString(" / ")

    return firstNotBlank(
        team.safeStr("teamName"),
        team.safeStr("teamFactionName"),
        team.safeStr("label"),
        team.safeStr("name"),
    )
}

fun resolveSideDisplayName(
    match: JsonObject?,
    side: String,
    allowRawFallback: Boolean = true,
): String? {
    val displayMode = resolveMatchDisplayMode(match)
    val normalizedSide = sideKeyOf(side)
    val pairKey = "pair$normalizedSide"
    resolvePairDisplayName(match.safeObj(pairKey), displayMode)
        ?.takeIf(::isUsefulSideDisplayName)
        ?.let { return it }
    resolveTeamDisplayName(match.safeObj("teams").safeObj(normalizedSide), displayMode)
        ?.takeIf(::isUsefulSideDisplayName)
        ?.let { return it }
    if (!allowRawFallback) return null

    val rawCandidates =
        if (normalizedSide == "A") {
            listOf(
                match.safeStr("resolvedSideNameA"),
                match.safeStr("__sideA"),
                match.safeStr("teamAName"),
                match.safeStr("pairAName"),
                match.safeStr("sideAName"),
                match.safeStr("teamFactionAName"),
            )
        } else {
            listOf(
                match.safeStr("resolvedSideNameB"),
                match.safeStr("__sideB"),
                match.safeStr("teamBName"),
                match.safeStr("pairBName"),
                match.safeStr("sideBName"),
                match.safeStr("teamFactionBName"),
            )
        }
    rawCandidates.firstOrNull(::isUsefulSideDisplayName)?.let { return it }

    val seedKey = if (normalizedSide == "A") "seedA" else "seedB"
    match.safeObj(seedKey)?.let { seed ->
        firstNotBlank(
            seed.safeStr("label"),
            seed.safeStr("displayName"),
            seed.safeStr("teamName"),
            seed.safeStr("name"),
            seed.safeStr("title"),
            seed.safeStr("code"),
        )?.takeIf(::isUsefulSideDisplayName)?.let { return it }
    }

    return null
}

fun hasMatchIdentityData(match: JsonObject?): Boolean =
    !resolveSideDisplayName(match, "A", allowRawFallback = false).isNullOrBlank() ||
        !resolveSideDisplayName(match, "B", allowRawFallback = false).isNullOrBlank()

fun isLightweightMatchPayload(
    root: JsonObject,
    match: JsonObject,
): Boolean {
    val informativeKeys =
        listOf(
            "pairA",
            "pairB",
            "teams",
            "teamAName",
            "teamBName",
            "gameScores",
            "scoreA",
            "scoreB",
            "serve",
            "status",
            "winner",
            "currentGame",
            "stageName",
            "phaseText",
            "roundLabel",
            "tournament",
            "court",
            "sets",
        )
    return informativeKeys.none { root.has(it) || match.has(it) }
}

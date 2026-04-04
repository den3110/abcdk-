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
    val explicit = pair.safeStr("displayName")
    if (!explicit.isNullOrBlank()) return explicit

    val joinedPlayers =
        listOf(
            resolvePlayerDisplayName(pair.safeObj("player1"), displayMode),
            resolvePlayerDisplayName(pair.safeObj("player2"), displayMode),
        ).filter { !it.isNullOrBlank() }

    if (joinedPlayers.isNotEmpty()) {
        return joinedPlayers.joinToString(" / ")
    }

    return firstNotBlank(
        pair.safeStr("teamName"),
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
        team.safeStr("name"),
        team.safeStr("teamName"),
    )
}

fun resolveSideDisplayName(
    match: JsonObject?,
    side: String,
    allowRawFallback: Boolean = true,
): String? {
    val displayMode = resolveMatchDisplayMode(match)
    val pairKey = if (side == "A") "pairA" else "pairB"
    resolvePairDisplayName(match.safeObj(pairKey), displayMode)?.let { return it }
    resolveTeamDisplayName(match.safeObj("teams").safeObj(side), displayMode)?.let { return it }
    if (!allowRawFallback) return null
    return if (side == "A") match.safeStr("teamAName") else match.safeStr("teamBName")
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

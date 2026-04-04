package com.pkt.live.streaming

enum class RecoveryStage(val label: String) {
    IDLE("Ổn định"),
    SOCKET_SELF_HEAL("Tự nối lại"),
    DEGRADED("Giảm tải"),
    OVERLAY_REBUILD("Dựng lại overlay"),
    PIPELINE_REBUILD("Dựng lại pipeline"),
    CAMERA_REBUILD("Dựng lại camera"),
    FAIL_SOFT_GUARD("Ngưỡng cảnh báo"),
}

enum class RecoverySeverity(val label: String) {
    INFO("Thông tin"),
    WARNING("Cảnh báo"),
    CRITICAL("Nghiêm trọng"),
}

data class StreamRecoveryState(
    val stage: RecoveryStage = RecoveryStage.IDLE,
    val severity: RecoverySeverity = RecoverySeverity.INFO,
    val summary: String = "",
    val detail: String? = null,
    val attempt: Int = 0,
    val budgetRemaining: Int = 0,
    val activeMitigations: List<String> = emptyList(),
    val lastFatalReason: String? = null,
    val isFailSoftImminent: Boolean = false,
    val atMs: Long = 0L,
)

package com.churchcomms.operator.control

/**
 * Bounded exponential reconnect policy from docs/design.md A8:
 * five attempts at 500 ms, 1 s, 2 s, 4 s, 8 s.
 *
 * The policy is pure so a test can assert the exact delays without waiting.
 */
class ReconnectPolicy(
    val maxAttempts: Int = MAX_ATTEMPTS,
    private val baseDelayMillis: Long = BASE_DELAY_MS,
    private val maximumDelayMillis: Long = MAX_DELAY_MS,
) {
    init {
        require(maxAttempts > 0) { "maxAttempts must be positive" }
        require(baseDelayMillis > 0) { "baseDelayMillis must be positive" }
        require(maximumDelayMillis >= baseDelayMillis) {
            "maximumDelayMillis must be at least baseDelayMillis"
        }
    }

    /** Delay before [attempt], where the first attempt is 1. */
    fun delayMillis(attempt: Int): Long {
        require(attempt >= 1) { "attempt starts at 1" }
        var delay = baseDelayMillis
        repeat(attempt - 1) {
            delay = if (delay >= maximumDelayMillis / 2) maximumDelayMillis else delay * 2
        }
        return delay.coerceAtMost(maximumDelayMillis)
    }

    companion object {
        const val MAX_ATTEMPTS = 5
        const val BASE_DELAY_MS = 500L
        const val MAX_DELAY_MS = 8_000L
    }
}

package com.churchcomms.operator.control

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class ReconnectPolicyTest {
    private val policy = ReconnectPolicy()

    @Test
    fun `uses the agreed bounded backoff for five attempts`() {
        assertEquals(500L, policy.delayMillis(1))
        assertEquals(1_000L, policy.delayMillis(2))
        assertEquals(2_000L, policy.delayMillis(3))
        assertEquals(4_000L, policy.delayMillis(4))
        assertEquals(8_000L, policy.delayMillis(5))
    }

    @Test
    fun `caps delays above the fifth attempt`() {
        assertEquals(8_000L, policy.delayMillis(6))
        assertEquals(8_000L, policy.delayMillis(20))
    }

    @Test
    fun `attempts start at one and the limit is five`() {
        assertEquals(5, policy.maxAttempts)
        assertThrows(IllegalArgumentException::class.java) {
            policy.delayMillis(0)
        }
    }
}

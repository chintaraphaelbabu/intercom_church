package com.churchcomms.operator.control

import android.content.Context

/**
 * Persists the per-join session token used to resume a room after a network
 * drop. The token is not an account credential; it only prevents a reconnect
 * from creating a duplicate participant.
 *
 * Production uses [SharedPreferencesSessionTokenStore]; tests use
 * [InMemorySessionTokenStore].
 */
interface SessionTokenStore {
    fun get(): String?
    fun save(token: String)
    fun clear()
}

class InMemorySessionTokenStore(initialToken: String? = null) : SessionTokenStore {
    private var token: String? = initialToken

    override fun get(): String? = token

    override fun save(token: String) {
        this.token = token
    }

    override fun clear() {
        token = null
    }
}

class SharedPreferencesSessionTokenStore(context: Context) : SessionTokenStore {
    private val preferences = context.applicationContext.getSharedPreferences(
        PREFERENCES_NAME,
        Context.MODE_PRIVATE,
    )

    override fun get(): String? = preferences.getString(KEY_SESSION_TOKEN, null)

    override fun save(token: String) {
        preferences.edit().putString(KEY_SESSION_TOKEN, token).apply()
    }

    override fun clear() {
        preferences.edit().remove(KEY_SESSION_TOKEN).apply()
    }

    private companion object {
        const val PREFERENCES_NAME = "church_comms_session"
        const val KEY_SESSION_TOKEN = "session_token"
    }
}

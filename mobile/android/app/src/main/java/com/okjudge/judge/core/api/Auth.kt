package com.okjudge.judge.core.api

/**
 * Where a signed-in session token lives. Phase 1 has no sign-in, so the app
 * uses [NoTokenStore]; phase 2 adds a Keystore-backed implementation and the
 * API client starts sending `Authorization: Bearer` without other changes.
 */
interface TokenStore {
    fun get(): String?
    fun set(token: String)
    fun clear()
}

object NoTokenStore : TokenStore {
    override fun get(): String? = null
    override fun set(token: String) = Unit
    override fun clear() = Unit
}

/** In-memory store, for tests and previews. */
class MemoryTokenStore(private var token: String? = null) : TokenStore {
    override fun get(): String? = token
    override fun set(token: String) {
        this.token = token
    }
    override fun clear() {
        token = null
    }
}

/**
 * Human check for free verdicts. A token is fetched right before each
 * POST /api/v1/verdict because tokens are single-use. `null` means the
 * build has no site key (servers without a Turnstile secret accept that).
 */
interface BotCheck {
    /** @throws BotCheckException when a token was needed but could not be produced. */
    suspend fun token(): String?
}

object NoBotCheck : BotCheck {
    override suspend fun token(): String? = null
}

class BotCheckException(message: String, cause: Throwable? = null) : Exception(message, cause)

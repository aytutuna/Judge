package com.okjudge.judge.core.api

/**
 * Where the signed-in session token lives. The app uses
 * [com.okjudge.judge.core.auth.KeystoreTokenStore]; [JudgeApi] sends the
 * token as `Authorization: Bearer` whenever there is one.
 */
interface TokenStore {
    fun get(): String?
    fun set(token: String)
    fun clear()
}

/** Never signed in: the default for API clients that do not need a session. */
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

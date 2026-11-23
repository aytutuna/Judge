package com.okjudge.judge.core.auth

import android.content.SharedPreferences

enum class SignInMethod { GOOGLE, EMAIL }

/** The method and address of the last successful sign-in on this phone, for the "Last used" tag and the prefilled email. */
class LastSignInStore(private val prefs: SharedPreferences) {
    val method: SignInMethod?
        get() = SignInMethod.entries.firstOrNull { it.name == prefs.getString(METHOD, null) }

    val email: String get() = prefs.getString(EMAIL, null).orEmpty()

    /** Google gives no address of its own, so [email] stays what it was then. */
    fun save(method: SignInMethod, email: String? = null) {
        prefs.edit().putString(METHOD, method.name).apply { if (email != null) putString(EMAIL, email) }.apply()
    }

    fun clear() = prefs.edit().clear().apply()

    companion object {
        const val FILE = "last_signin"
        private const val METHOD = "method"
        private const val EMAIL = "email"
    }
}

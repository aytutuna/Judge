package com.okjudge.judge.core.auth

import android.content.Context
import android.content.SharedPreferences
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import com.okjudge.judge.core.api.TokenStore
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Encrypts and decrypts the session token; swapped for a fake in tests (no Keystore there). */
interface TokenCipher {
    fun encrypt(plain: String): String
    fun decrypt(sealed: String): String
}

/**
 * AES-256-GCM with a key that never leaves the Android Keystore. The stored
 * form is base64(iv || ciphertext+tag).
 */
class KeystoreTokenCipher(private val alias: String = "judge_session_key") : TokenCipher {
    private fun key(): SecretKey {
        val store = KeyStore.getInstance(KEYSTORE).apply { load(null) }
        (store.getKey(alias, null) as? SecretKey)?.let { return it }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE)
        generator.init(
            KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build(),
        )
        return generator.generateKey()
    }

    override fun encrypt(plain: String): String {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, key())
        val sealed = cipher.iv + cipher.doFinal(plain.toByteArray(Charsets.UTF_8))
        return Base64.encodeToString(sealed, Base64.NO_WRAP)
    }

    override fun decrypt(sealed: String): String {
        val bytes = Base64.decode(sealed, Base64.NO_WRAP)
        require(bytes.size > IV_BYTES) { "sealed token too short" }
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(TAG_BITS, bytes, 0, IV_BYTES))
        return String(cipher.doFinal(bytes, IV_BYTES, bytes.size - IV_BYTES), Charsets.UTF_8)
    }

    private companion object {
        const val KEYSTORE = "AndroidKeyStore"
        const val TRANSFORMATION = "AES/GCM/NoPadding"
        const val IV_BYTES = 12
        const val TAG_BITS = 128
    }
}

/**
 * The session token, encrypted at rest in a private SharedPreferences file
 * (excluded from backup and device transfer like all app data). The
 * decrypted token is cached in memory after the first read, so the per-call
 * lookup in JudgeApi costs nothing.
 *
 * A token that cannot be decrypted (the Keystore key is gone) counts as
 * signed out and is removed. When encryption fails the token is kept for
 * this process only rather than written in the clear.
 */
class KeystoreTokenStore(
    private val prefs: SharedPreferences,
    private val cipher: TokenCipher = KeystoreTokenCipher(),
) : TokenStore {
    constructor(context: Context) : this(context.applicationContext.getSharedPreferences(FILE, Context.MODE_PRIVATE))

    private val lock = Any()
    @Volatile private var loaded = false
    @Volatile private var cached: String? = null

    override fun get(): String? {
        if (!loaded) {
            synchronized(lock) {
                if (!loaded) {
                    cached = read()
                    loaded = true
                }
            }
        }
        return cached
    }

    override fun set(token: String) {
        synchronized(lock) {
            cached = token
            loaded = true
            val sealed = runCatching { cipher.encrypt(token) }.getOrNull()
            prefs.edit().apply { if (sealed != null) putString(KEY, sealed) else remove(KEY) }.apply()
        }
    }

    override fun clear() {
        synchronized(lock) {
            cached = null
            loaded = true
            prefs.edit().remove(KEY).apply()
        }
    }

    private fun read(): String? {
        val sealed = prefs.getString(KEY, null) ?: return null
        return runCatching { cipher.decrypt(sealed) }.getOrNull()?.takeIf { it.isNotBlank() } ?: run {
            prefs.edit().remove(KEY).apply()
            null
        }
    }

    companion object {
        const val FILE = "session"
        const val KEY = "token"
    }
}

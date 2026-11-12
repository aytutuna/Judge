package com.okjudge.judge.core.auth

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import java.security.InvalidKeyException
import java.security.KeyStoreException
import java.security.UnrecoverableKeyException
import javax.crypto.AEADBadTagException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class KeystoreTokenStoreTest {
    private val prefs = ApplicationProvider.getApplicationContext<Context>()
        .getSharedPreferences(KeystoreTokenStore.FILE, Context.MODE_PRIVATE)

    @Before
    fun clean() {
        prefs.edit().clear().commit()
    }

    @Test
    fun storesOnlyCiphertext_andANewInstanceReadsItBack() {
        KeystoreTokenStore(prefs, FakeCipher()).set("secret-token")
        val raw = prefs.getString(KeystoreTokenStore.KEY, null)!!
        assertFalse(raw.contains("secret-token"))
        assertEquals("secret-token", KeystoreTokenStore(prefs, FakeCipher()).get())
    }

    @Test
    fun clear_removesItEverywhere() {
        val store = KeystoreTokenStore(prefs, FakeCipher())
        store.set("t")
        store.clear()
        assertNull(store.get())
        assertNull(KeystoreTokenStore(prefs, FakeCipher()).get())
    }

    @Test
    fun theUser_belongsToTheTokenItWasNamedFor() {
        val store = KeystoreTokenStore(prefs, FakeCipher())
        store.set("a")
        store.setUser("u1")
        assertEquals("u1", KeystoreTokenStore(prefs, FakeCipher()).user())
        store.set("b")
        assertNull("a new session waits for /me", KeystoreTokenStore(prefs, FakeCipher()).user())
        store.setUser("u2")
        store.clear()
        assertNull(store.user())
        assertNull(prefs.getString(KeystoreTokenStore.USER, null))
    }

    @Test
    fun anUndecryptableToken_countsAsSignedOut_andIsDropped() {
        prefs.edit().putString(KeystoreTokenStore.KEY, "garbage").commit()
        assertNull(KeystoreTokenStore(prefs, FakeCipher()).get())
        assertNull(prefs.getString(KeystoreTokenStore.KEY, null))
    }

    private fun failing(error: Exception) = object : TokenCipher {
        override fun encrypt(plain: String) = plain
        override fun decrypt(sealed: String): String = throw error
    }

    @Test
    fun aGoneKeyOrBadData_dropsTheToken() {
        for (error in listOf(InvalidKeyException("invalidated"), UnrecoverableKeyException("gone"), AEADBadTagException("tag"))) {
            prefs.edit().putString(KeystoreTokenStore.KEY, "sealed").commit()
            assertNull(KeystoreTokenStore(prefs, failing(error)).get())
            assertNull(prefs.getString(KeystoreTokenStore.KEY, null))
        }
    }

    @Test
    fun aTransientKeystoreError_signsOutThisRunButKeepsTheToken() {
        prefs.edit().putString(KeystoreTokenStore.KEY, "sealed").commit()
        assertNull(KeystoreTokenStore(prefs, failing(KeyStoreException("busy"))).get())
        assertNotNull(prefs.getString(KeystoreTokenStore.KEY, null))
        assertEquals("secret", KeystoreTokenStore(prefs, object : TokenCipher {
            override fun encrypt(plain: String) = plain
            override fun decrypt(sealed: String) = "secret"
        }).get())
    }

    @Test
    fun whenEncryptionFails_theTokenLivesInMemoryOnly() {
        val store = KeystoreTokenStore(prefs, FakeCipher(failEncrypt = true))
        store.set("t")
        assertEquals("t", store.get())
        assertNull(prefs.getString(KeystoreTokenStore.KEY, null))
    }

    @Test
    fun noKeystore_noToken_isSignedOut() {
        // The real cipher is never touched while nothing is stored (Robolectric has no AndroidKeyStore).
        assertNull(KeystoreTokenStore(prefs).get())
    }
}

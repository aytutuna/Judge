package com.okjudge.judge.core.auth

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
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
    fun anUndecryptableToken_countsAsSignedOut_andIsDropped() {
        prefs.edit().putString(KeystoreTokenStore.KEY, "garbage").commit()
        assertNull(KeystoreTokenStore(prefs, FakeCipher()).get())
        assertNull(prefs.getString(KeystoreTokenStore.KEY, null))
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

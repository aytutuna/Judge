package com.okjudge.judge.core.auth

import android.content.Context
import androidx.credentials.CredentialManager
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialException
import androidx.credentials.exceptions.NoCredentialException
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import com.google.android.libraries.identity.googleid.GoogleIdTokenParsingException
import kotlinx.coroutines.CancellationException

/** What the device's Google account picker gave back. */
sealed interface GoogleIdResult {
    data class Token(val idToken: String) : GoogleIdResult
    /** The user closed the picker. */
    data object Cancelled : GoogleIdResult
    /** No Google account or Play services on this device, or no client id in the build. */
    data object Unavailable : GoogleIdResult
    data object Failed : GoogleIdResult
}

/** Gets a Google ID token for the server's client id. [host] must be an Activity context. */
fun interface GoogleIdTokenSource {
    suspend fun idToken(host: Context): GoogleIdResult
}

/**
 * Credential Manager's "Sign in with Google" flow (the button flow, which
 * lists every Google account on the device and offers to add one).
 * [serverClientId] is the OAuth web client id: it becomes the token's
 * audience, which the server checks.
 */
class CredentialManagerGoogle(private val serverClientId: String) : GoogleIdTokenSource {
    override suspend fun idToken(host: Context): GoogleIdResult {
        if (serverClientId.isBlank()) return GoogleIdResult.Unavailable
        val request = GetCredentialRequest.Builder()
            .addCredentialOption(GetSignInWithGoogleOption.Builder(serverClientId).build())
            .build()
        return try {
            val credential = CredentialManager.create(host).getCredential(host, request).credential
            if (credential is CustomCredential && credential.type == GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL) {
                GoogleIdResult.Token(GoogleIdTokenCredential.createFrom(credential.data).idToken)
            } else {
                GoogleIdResult.Failed
            }
        } catch (e: CancellationException) {
            throw e
        } catch (_: GetCredentialCancellationException) {
            GoogleIdResult.Cancelled
        } catch (_: NoCredentialException) {
            GoogleIdResult.Unavailable
        } catch (_: GetCredentialException) {
            GoogleIdResult.Failed
        } catch (_: GoogleIdTokenParsingException) {
            GoogleIdResult.Failed
        }
    }
}

package com.okjudge.judge.core.auth

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import com.google.android.gms.tasks.Task
import com.google.android.play.agesignals.AgeSignalsAccessRequest
import com.google.android.play.agesignals.AgeSignalsManagerFactory
import com.google.android.play.agesignals.AgeSignalsRequest
import com.google.android.play.agesignals.model.AgeSignalsStatus
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/**
 * Google Play Age Signals: the sharing check first (Play may show its own
 * prompt over [host]), then the age range when the user shares it. Not
 * installed from Play, no Play Store, not shared, or any error: unknown,
 * and the sign-in checkbox takes over.
 */
class PlayAgeSignals(context: Context) : AgeSignalSource {
    private val appContext = context.applicationContext

    override suspend fun check(host: Context): PlatformAge {
        val activity = host.findActivity() ?: return PlatformAge.UNKNOWN
        return try {
            val manager = AgeSignalsManagerFactory.create(appContext)
            val access = manager.requestAgeSignalsAccess(AgeSignalsAccessRequest.builder().setActivity(activity).build()).await()
            if (access.ageSignalsStatus() != AgeSignalsStatus.SHARED) return PlatformAge.UNKNOWN
            val result = manager.checkAgeSignals(AgeSignalsRequest.builder().build()).await()
            AgeCheck.fromRange(result.ageLower(), result.ageUpper())
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
            PlatformAge.UNKNOWN
        }
    }
}

private tailrec fun Context.findActivity(): Activity? = when (this) {
    is Activity -> this
    is ContextWrapper -> baseContext.findActivity()
    else -> null
}

private suspend fun <T> Task<T>.await(): T = suspendCancellableCoroutine { cont ->
    addOnCompleteListener { task ->
        val error = task.exception
        when {
            error != null -> cont.resumeWithException(error)
            task.isCanceled -> cont.cancel()
            else -> cont.resume(task.result)
        }
    }
}

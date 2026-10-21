package com.okjudge.judge.core.purchases

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import com.revenuecat.purchases.CustomerInfo
import com.revenuecat.purchases.Package
import com.revenuecat.purchases.PurchaseParams
import com.revenuecat.purchases.Purchases
import com.revenuecat.purchases.PurchasesConfiguration
import com.revenuecat.purchases.PurchasesErrorCode
import com.revenuecat.purchases.PurchasesTransactionException
import com.revenuecat.purchases.awaitCustomerInfo
import com.revenuecat.purchases.awaitLogIn
import com.revenuecat.purchases.awaitLogOut
import com.revenuecat.purchases.awaitOfferings
import com.revenuecat.purchases.awaitPurchase
import com.revenuecat.purchases.awaitRestore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlin.coroutines.cancellation.CancellationException

/**
 * RevenueCat with the public SDK key. The SDK is configured on the first
 * [logIn], with our user id as the app user id, so it never runs (or makes
 * an anonymous buyer) before the app knows who is signed in.
 */
class RevenueCatGateway(context: Context, private val apiKey: String) : PurchaseGateway {
    private val appContext = context.applicationContext

    /** The packages of the last [offers] call, by our product id. */
    @Volatile private var packages: Map<String, Package> = emptyMap()

    private val shared: Purchases? get() = if (Purchases.isConfigured) Purchases.sharedInstance else null

    override suspend fun logIn(userId: String): StoreCustomer? = attempt {
        val purchases = shared ?: withContext(Dispatchers.Main) {
            Purchases.configure(
                PurchasesConfiguration.Builder(appContext, apiKey)
                    .appUserID(userId)
                    // No advertising or device ids: the app does no attribution.
                    .automaticDeviceIdentifierCollectionEnabled(false)
                    .build(),
            )
        }
        val info = if (purchases.appUserID == userId) purchases.awaitCustomerInfo() else purchases.awaitLogIn(userId).customerInfo
        customer(info)
    }

    override suspend fun logOut() {
        packages = emptyMap()
        val purchases = shared ?: return
        if (purchases.isAnonymous) return
        attempt { purchases.awaitLogOut() }
    }

    override suspend fun offers(): Map<String, StoreOffer>? = attempt {
        val purchases = shared ?: return@attempt null
        val found = purchases.awaitOfferings().current?.availablePackages.orEmpty()
            .filter { StoreProducts.key(it.product.id) in StoreProducts.ALL }
            .associateBy { StoreProducts.key(it.product.id) }
        packages = found
        found.mapValues { (id, pkg) ->
            val price = pkg.product.price
            StoreOffer(id, price.formatted, price.amountMicros, price.currencyCode)
        }
    }

    override suspend fun purchase(host: Context, productId: String): PurchaseOutcome {
        val purchases = shared ?: return PurchaseOutcome.Failed
        val pkg = packages[productId] ?: return PurchaseOutcome.Failed
        val activity = host.findActivity() ?: return PurchaseOutcome.Failed
        return try {
            val result = purchases.awaitPurchase(PurchaseParams.Builder(activity, pkg).build())
            PurchaseOutcome.Bought(customer(result.customerInfo))
        } catch (e: PurchasesTransactionException) {
            when {
                e.userCancelled -> PurchaseOutcome.Cancelled
                e.error.code == PurchasesErrorCode.PaymentPendingError -> PurchaseOutcome.Pending
                else -> PurchaseOutcome.Failed
            }
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
            PurchaseOutcome.Failed
        }
    }

    override suspend fun restore(): RestoreOutcome {
        val purchases = shared ?: return RestoreOutcome.Failed
        return attempt { RestoreOutcome.Restored(customer(purchases.awaitRestore())) } ?: RestoreOutcome.Failed
    }

    private fun customer(info: CustomerInfo) = StoreCustomer(subscriptionActive = info.activeSubscriptions.isNotEmpty())

    private inline fun <T> attempt(block: () -> T): T? = try {
        block()
    } catch (e: CancellationException) {
        throw e
    } catch (_: Exception) {
        null
    }

    companion object {
        /** No SDK key in this build: purchases stay off. */
        fun createOrNull(context: Context, apiKey: String): PurchaseGateway? =
            apiKey.trim().takeIf { it.isNotEmpty() }?.let { RevenueCatGateway(context, it) }
    }
}

private tailrec fun Context.findActivity(): Activity? = when (this) {
    is Activity -> this
    is ContextWrapper -> baseContext.findActivity()
    else -> null
}

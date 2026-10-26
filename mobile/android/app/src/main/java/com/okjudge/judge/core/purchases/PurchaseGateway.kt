package com.okjudge.judge.core.purchases

import android.content.Context

/** Store product ids the server knows (STORE_PRODUCTS in lib/pricing.ts). */
object StoreProducts {
    const val PACK_1 = "pack_1"
    const val PACK_10 = "pack_10"
    const val MONTHLY = "monthly"

    val ALL = listOf(PACK_1, PACK_10, MONTHLY)

    /**
     * Our product id for a store product id. Play subscriptions come back as
     * `monthly:<base plan>`; one-time products as the plain id.
     */
    fun key(storeProductId: String): String = storeProductId.substringBefore(':')
}

/** A product the store sells right now, priced in the buyer's own currency. */
data class StoreOffer(
    val productId: String,
    /** The store's formatted price ("₺49,99"). */
    val price: String,
    val amountMicros: Long,
    val currencyCode: String,
)

/** What the store says about the signed-in buyer. Display only: the server grants. */
data class StoreCustomer(val subscriptionActive: Boolean)

sealed interface PurchaseOutcome {
    data class Bought(val customer: StoreCustomer) : PurchaseOutcome

    /** The store accepted the order but payment is still pending (cash, bank transfer). */
    data object Pending : PurchaseOutcome
    data object Cancelled : PurchaseOutcome
    data object Failed : PurchaseOutcome
}

sealed interface RestoreOutcome {
    data class Restored(val customer: StoreCustomer) : RestoreOutcome
    data object Failed : RestoreOutcome
}

/**
 * The in-app purchase SDK behind a seam: [RevenueCatGateway] in the app, a
 * fake in tests. Every call may suspend on the network.
 */
interface PurchaseGateway {
    /** Makes [userId] the store's buyer (configuring the SDK on first use); null when that failed. */
    suspend fun logIn(userId: String): StoreCustomer?

    /** Forgets the buyer. Safe to call when nobody is logged in. */
    suspend fun logOut()

    /** The products the store can sell now, by our product id; null when they could not be loaded. */
    suspend fun offers(): Map<String, StoreOffer>?

    /** Buys [productId] from [offers]; [host] is the visible activity (or a context wrapping it). */
    suspend fun purchase(host: Context, productId: String): PurchaseOutcome

    suspend fun restore(): RestoreOutcome
}

package com.okjudge.judge.core.purchases

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import com.okjudge.judge.core.auth.Account
import com.okjudge.judge.core.model.Entitlement
import com.okjudge.judge.core.model.MeResponse
import com.okjudge.judge.core.model.SubscriptionView
import com.okjudge.judge.core.model.Viewer
import com.okjudge.judge.core.purchases.PurchaseController.Notice
import com.okjudge.judge.core.purchases.PurchaseController.RestoreNotice
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** A store that answers from fields and records every call. */
class FakeGateway : PurchaseGateway {
    val calls = mutableListOf<String>()
    var logInResult: StoreCustomer? = StoreCustomer(subscriptionActive = false)
    var offersResult: Map<String, StoreOffer>? = OFFERS
    var purchaseOutcome: PurchaseOutcome = PurchaseOutcome.Bought(StoreCustomer(subscriptionActive = false))
    var restoreOutcome: RestoreOutcome = RestoreOutcome.Restored(StoreCustomer(subscriptionActive = true))

    /** When set, purchase() waits for it (to look at the state mid-purchase). */
    var purchaseGate: CompletableDeferred<Unit>? = null

    override suspend fun logIn(userId: String): StoreCustomer? {
        calls += "logIn:$userId"
        return logInResult
    }

    override suspend fun logOut() {
        calls += "logOut"
    }

    override suspend fun offers(): Map<String, StoreOffer>? {
        calls += "offers"
        return offersResult
    }

    override suspend fun purchase(host: Context, productId: String): PurchaseOutcome {
        calls += "purchase:$productId"
        purchaseGate?.await()
        return purchaseOutcome
    }

    override suspend fun restore(): RestoreOutcome {
        calls += "restore"
        return restoreOutcome
    }

    companion object {
        val OFFERS = mapOf(
            "pack_10" to StoreOffer("pack_10", "₺79,99", 79_990_000, "TRY"),
            "pack_30" to StoreOffer("pack_30", "₺199,99", 199_990_000, "TRY"),
            "monthly" to StoreOffer("monthly", "₺199,99", 199_990_000, "TRY"),
        )
    }
}

@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class PurchaseControllerTest {
    private val context: Context = ApplicationProvider.getApplicationContext()
    private val gateway = FakeGateway()
    private val account = MutableStateFlow<Account.State>(Account.State.SignedIn())
    private var refreshes = 0

    /** What the next /me reads return, by call number (1-based); unchanged otherwise. */
    private var onRefresh: (Int) -> Unit = {}

    /** Runs everything due within a minute (the controller works in the background scope). */
    private fun TestScope.settle() {
        advanceTimeBy(60_000)
        runCurrent()
    }

    private fun signedIn(id: String = "u1", credits: Int = 0, subscription: SubscriptionView? = null) =
        Account.State.SignedIn(
            MeResponse(Viewer(id, "$id@example.com"), Entitlement(canUsePremium = credits > 0, credits = credits, subscription = subscription)),
        )

    private fun TestScope.controller(gateway: PurchaseGateway? = this@PurchaseControllerTest.gateway) =
        PurchaseController(
            gateway,
            account,
            refreshAccount = {
                refreshes++
                onRefresh(refreshes)
            },
            scope = backgroundScope,
        )

    /** Started and logged in as u1, with the offers loaded. */
    private fun TestScope.ready(credits: Int = 0): PurchaseController {
        account.value = signedIn(credits = credits)
        val c = controller()
        c.start()
        runCurrent()
        assertTrue(c.isReady())
        gateway.calls.clear()
        return c
    }

    @Test
    fun noSdkKey_everythingStaysOff() = runTest {
        account.value = signedIn()
        val c = controller(gateway = null)
        c.start()
        settle()
        assertFalse(c.state.value.available)
        assertNull(c.buy(context, "pack_10"))
        assertNull(c.restore())
        assertNull(RevenueCatGateway.createOrNull(context, ""))
        assertNull(RevenueCatGateway.createOrNull(context, "   "))
        assertNotNull(RevenueCatGateway.createOrNull(context, "goog_public_key"))
    }

    @Test
    fun logIn_waitsForMeToNameTheUser_andFollowsTheSession() = runTest {
        account.value = Account.State.SignedIn(me = null)
        val c = controller()
        c.start()
        settle()
        // Signed in, but nobody known yet: the store is not touched.
        assertEquals(emptyList<String>(), gateway.calls)
        assertFalse(c.isReady())

        account.value = signedIn("u1")
        settle()
        assertEquals(listOf("logIn:u1", "offers"), gateway.calls)
        assertEquals("u1", c.state.value.storeUserId)
        assertEquals(FakeGateway.OFFERS, c.state.value.offers)
        assertTrue(c.isReady())

        // Another /me read for the same user changes nothing.
        account.value = signedIn("u1", credits = 3)
        settle()
        assertEquals(2, gateway.calls.size)

        account.value = Account.State.SignedOut
        settle()
        assertEquals("logOut", gateway.calls.last())
        assertNull(c.state.value.storeUserId)
        assertTrue(c.state.value.offers.isEmpty())
        assertTrue(c.state.value.available)

        account.value = signedIn("u2")
        settle()
        assertEquals(listOf("logIn:u2", "offers"), gateway.calls.takeLast(2))
        assertEquals("u2", c.state.value.storeUserId)
    }

    @Test
    fun signedOutAtLaunch_neverLogsIn() = runTest {
        account.value = Account.State.SignedOut
        val c = controller()
        c.start()
        settle()
        assertTrue(gateway.calls.none { it.startsWith("logIn") })
        assertNull(c.buy(context, "pack_10"))
    }

    @Test
    fun failedLogIn_staysOff_untilAScreenRetries() = runTest {
        gateway.logInResult = null
        account.value = signedIn()
        val c = controller()
        c.start()
        settle()
        assertFalse(c.isReady())
        assertNull(c.buy(context, "pack_10"))

        gateway.logInResult = StoreCustomer(subscriptionActive = true)
        c.refresh()
        settle()
        assertTrue(c.isReady())
        assertTrue(c.state.value.subscriptionInStore)
        assertEquals(FakeGateway.OFFERS, c.state.value.offers)
    }

    @Test
    fun purchase_success_pollsMeUntilTheCreditsChange() = runTest {
        val c = ready(credits = 0)
        val gate = CompletableDeferred<Unit>()
        gateway.purchaseGate = gate
        onRefresh = { n -> if (n == 3) account.value = signedIn(credits = 10) }

        assertNotNull(c.buy(context, "pack_10"))
        runCurrent()
        assertEquals("pack_10", c.state.value.buying)
        // One purchase at a time.
        assertNull(c.buy(context, "pack_30"))

        gate.complete(Unit)
        runCurrent()
        assertNull(c.state.value.buying)
        assertEquals(Notice.ARRIVING, c.state.value.notice)
        assertEquals(0, refreshes)

        // The third read (after 1 + 1.5 + 2 s) shows the credits.
        advanceTimeBy(4_499)
        runCurrent()
        assertEquals(Notice.ARRIVING, c.state.value.notice)
        assertEquals(2, refreshes)
        advanceTimeBy(2)
        runCurrent()
        assertEquals(Notice.ARRIVED, c.state.value.notice)
        assertEquals(3, refreshes)
        settle()
        assertEquals(3, refreshes)
        assertEquals(listOf("purchase:pack_10"), gateway.calls)
    }

    @Test
    fun purchase_success_grantNeverShows_saysItMayTakeAMinute() = runTest {
        val c = ready()
        c.buy(context, "monthly")
        runCurrent()
        // Five reads over ten seconds, then the "may take a minute" line.
        advanceTimeBy(9_999)
        runCurrent()
        assertEquals(Notice.ARRIVING, c.state.value.notice)
        advanceTimeBy(2)
        runCurrent()
        assertEquals(Notice.SLOW, c.state.value.notice)
        assertEquals(PurchaseController.POLL_DELAYS_MS.size, refreshes)
        assertEquals(10_000L, PurchaseController.POLL_DELAYS_MS.sum())
    }

    @Test
    fun purchase_subscription_arrivesWhenMeShowsIt() = runTest {
        val c = ready()
        gateway.purchaseOutcome = PurchaseOutcome.Bought(StoreCustomer(subscriptionActive = true))
        val sub = SubscriptionView(source = "play_store", productId = "monthly", periodEnd = "2026-11-21T00:00:00Z", willRenew = true, cap = 60)
        onRefresh = { n -> if (n == 2) account.value = signedIn(subscription = sub) }
        c.buy(context, "monthly")
        runCurrent()
        assertTrue(c.state.value.subscriptionInStore)
        settle()
        assertEquals(Notice.ARRIVED, c.state.value.notice)
        assertEquals(2, refreshes)
        assertFalse(PurchaseController.subscriptionPending(c.state.value, (account.value as Account.State.SignedIn).me?.entitlement))
    }

    @Test
    fun purchase_cancelled_noMessageAndNoRefresh() = runTest {
        val c = ready()
        gateway.purchaseOutcome = PurchaseOutcome.Cancelled
        c.buy(context, "pack_30")
        settle()
        assertNull(c.state.value.notice)
        assertNull(c.state.value.buying)
        assertEquals(0, refreshes)
    }

    @Test
    fun purchase_failed_showsTheError_withoutRefresh() = runTest {
        val c = ready()
        gateway.purchaseOutcome = PurchaseOutcome.Failed
        c.buy(context, "pack_10")
        settle()
        assertEquals(Notice.FAILED, c.state.value.notice)
        assertNull(c.state.value.buying)
        assertEquals(0, refreshes)

        // Opening the screen again drops the old message.
        c.refresh()
        assertNull(c.state.value.notice)
    }

    @Test
    fun purchase_paymentPending_waitsLikeASuccess() = runTest {
        val c = ready()
        gateway.purchaseOutcome = PurchaseOutcome.Pending
        c.buy(context, "pack_10")
        runCurrent()
        assertEquals(Notice.ARRIVING, c.state.value.notice)
        settle()
        assertEquals(Notice.SLOW, c.state.value.notice)
    }

    @Test
    fun purchase_signOutWhilePolling_dropsTheMessage() = runTest {
        val c = ready()
        onRefresh = { n -> if (n == 1) account.value = Account.State.SignedOut }
        c.buy(context, "pack_10")
        settle()
        assertNull(c.state.value.notice)
        assertEquals(1, refreshes)
        assertEquals("logOut", gateway.calls.last())
    }

    @Test
    fun purchase_unknownProduct_orNotReady_doesNothing() = runTest {
        val c = ready()
        assertNull(c.buy(context, "lifetime"))
        gateway.calls.clear()
        account.value = Account.State.SignedIn(me = null)
        settle()
        assertFalse(c.isReady())
        assertNull(c.buy(context, "pack_10"))
        assertTrue(gateway.calls.none { it.startsWith("purchase") })
    }

    @Test
    fun restore_activeSubscription_saysRestored_andWaitsForTheServer() = runTest {
        val c = ready()
        val sub = SubscriptionView(source = "play_store", productId = "monthly", periodEnd = "2026-11-21T00:00:00Z", willRenew = true, cap = 60)
        onRefresh = { n -> if (n == 2) account.value = signedIn(subscription = sub) }
        assertNotNull(c.restore())
        runCurrent()
        assertEquals(RestoreNotice.DONE, c.state.value.restoreNotice)
        assertFalse(c.state.value.restoring)
        // Meanwhile the pricing screen says the subscription is on its way.
        assertTrue(PurchaseController.subscriptionPending(c.state.value, Entitlement()))
        settle()
        assertEquals(2, refreshes)
        assertEquals(listOf("restore"), gateway.calls)
    }

    @Test
    fun restore_nothingInTheStore_saysSo() = runTest {
        val c = ready()
        gateway.restoreOutcome = RestoreOutcome.Restored(StoreCustomer(subscriptionActive = false))
        c.restore()
        settle()
        assertEquals(RestoreNotice.NONE, c.state.value.restoreNotice)
        assertFalse(c.state.value.subscriptionInStore)
        assertEquals(1, refreshes)
    }

    @Test
    fun restore_failure_showsTheError() = runTest {
        val c = ready()
        gateway.restoreOutcome = RestoreOutcome.Failed
        c.restore()
        settle()
        assertEquals(RestoreNotice.FAILED, c.state.value.restoreNotice)
        assertEquals(0, refreshes)
    }

    @Test
    fun storeProductKeys_dropThePlayBasePlan() {
        assertEquals("monthly", StoreProducts.key("monthly:monthly-base"))
        assertEquals("pack_10", StoreProducts.key("pack_10"))
    }

    @Test
    fun subscriptionPending_onlyWhenTheStoreHasItAndTheServerDoesNot() {
        val inStore = PurchaseController.State(available = true, subscriptionInStore = true)
        assertTrue(PurchaseController.subscriptionPending(inStore, Entitlement()))
        assertFalse(PurchaseController.subscriptionPending(inStore, null))
        assertFalse(PurchaseController.subscriptionPending(inStore, Entitlement(subscription = SubscriptionView())))
        assertFalse(PurchaseController.subscriptionPending(inStore.copy(subscriptionInStore = false), Entitlement()))
    }
}

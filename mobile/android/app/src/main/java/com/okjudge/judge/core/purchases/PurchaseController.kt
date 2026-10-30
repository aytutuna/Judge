package com.okjudge.judge.core.purchases

import android.content.Context
import com.okjudge.judge.core.auth.Account
import com.okjudge.judge.core.model.Entitlement
import com.okjudge.judge.core.model.SubscriptionView
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * Store purchases for the signed-in account. The store's buyer follows the
 * session (log in with our user id once /me names it, log out on sign-out),
 * so the server's webhook can match the purchase to the account. Nothing is
 * granted here: after a purchase /me is read again until the server's grant
 * shows up. What the store reports is only used to pick the message.
 *
 * [gateway] is null when the build has no SDK key: everything stays off.
 */
class PurchaseController(
    private val gateway: PurchaseGateway?,
    private val accountState: StateFlow<Account.State>,
    private val refreshAccount: suspend () -> Unit,
    private val scope: CoroutineScope,
    private val pollDelaysMs: List<Long> = POLL_DELAYS_MS,
    /** Told when the store reports a completed purchase (not a pending one). */
    private val onBought: () -> Unit = {},
) {
    /** The purchase message on the pricing screen. */
    enum class Notice {
        /** Bought; waiting for the server's grant. */
        ARRIVING,
        /** Bought, and /me shows it. */
        ARRIVED,
        /** Bought, but /me did not show it within the polling window. */
        SLOW,
        FAILED,
    }

    enum class RestoreNotice { DONE, NONE, FAILED }

    data class State(
        /** This build has an SDK key. */
        val available: Boolean = false,
        /** The account the store is logged in as; purchases wait until it is the signed-in one. */
        val storeUserId: String? = null,
        /** What the store sells, by our product id. */
        val offers: Map<String, StoreOffer> = emptyMap(),
        /** The product being bought. */
        val buying: String? = null,
        val notice: Notice? = null,
        /** The store has an active subscription for this buyer (display only). */
        val subscriptionInStore: Boolean = false,
        val restoring: Boolean = false,
        val restoreNotice: RestoreNotice? = null,
    )

    private val _state = MutableStateFlow(State(available = gateway != null))
    val state: StateFlow<State> = _state.asStateFlow()

    private val storeLock = Mutex()
    private var started = false

    private sealed interface Who {
        /** Signed in, but /me has not named the user yet. */
        data object Unknown : Who
        data object SignedOut : Who
        data class User(val id: String) : Who
    }

    private fun who(state: Account.State): Who = when (state) {
        Account.State.SignedOut -> Who.SignedOut
        is Account.State.SignedIn -> state.me?.user?.id?.let { Who.User(it) } ?: Who.Unknown
    }

    private val currentUserId: String? get() = (who(accountState.value) as? Who.User)?.id

    /** Follows the session for the life of the process. No-op without an SDK key. */
    fun start() {
        if (gateway == null || started) return
        started = true
        scope.launch {
            accountState.map(::who).distinctUntilChanged().collect { who ->
                when (who) {
                    Who.Unknown -> Unit
                    Who.SignedOut -> storeLock.withLock {
                        _state.update { State(available = true) }
                        gateway.logOut()
                    }
                    is Who.User -> storeLock.withLock { logInLocked(gateway, who.id) }
                }
            }
        }
    }

    /**
     * A screen that shows purchases opened: retries a failed log-in or offer
     * load, and drops messages about earlier purchases that have settled.
     */
    fun refresh() {
        val gateway = gateway ?: return
        _state.update {
            it.copy(
                notice = if (it.notice == Notice.ARRIVING) it.notice else null,
                restoreNotice = null,
            )
        }
        scope.launch {
            storeLock.withLock {
                val userId = currentUserId ?: return@withLock
                if (_state.value.storeUserId != userId) {
                    logInLocked(gateway, userId)
                } else if (_state.value.offers.isEmpty()) {
                    loadOffersLocked(gateway, userId)
                }
            }
        }
    }

    private suspend fun logInLocked(gateway: PurchaseGateway, userId: String) {
        _state.update { State(available = true) }
        val customer = gateway.logIn(userId) ?: return
        if (currentUserId != userId) return
        _state.update { it.copy(storeUserId = userId, subscriptionInStore = customer.subscriptionActive) }
        loadOffersLocked(gateway, userId)
    }

    private suspend fun loadOffersLocked(gateway: PurchaseGateway, userId: String) {
        val offers = gateway.offers() ?: return
        if (currentUserId != userId || _state.value.storeUserId != userId) return
        _state.update { it.copy(offers = offers) }
    }

    /** The store is logged in as the signed-in account. */
    fun isReady(state: State = _state.value): Boolean = state.storeUserId != null && state.storeUserId == currentUserId

    /** Buys [productId]; null when nothing started (no store, not ready, another purchase running). */
    fun buy(host: Context, productId: String): Job? {
        val gateway = gateway ?: return null
        val current = _state.value
        if (current.buying != null || !isReady(current) || productId !in current.offers) return null
        _state.update { it.copy(buying = productId, notice = null) }
        val before = grantOf(accountState.value)
        return scope.launch {
            val outcome = try {
                gateway.purchase(host, productId)
            } finally {
                _state.update { it.copy(buying = null) }
            }
            when (outcome) {
                PurchaseOutcome.Cancelled -> Unit
                PurchaseOutcome.Failed -> _state.update { it.copy(notice = Notice.FAILED) }
                is PurchaseOutcome.Bought, PurchaseOutcome.Pending -> {
                    if (outcome is PurchaseOutcome.Bought) onBought()
                    val inStore = (outcome as? PurchaseOutcome.Bought)?.customer?.subscriptionActive == true
                    _state.update { it.copy(notice = Notice.ARRIVING, subscriptionInStore = it.subscriptionInStore || inStore) }
                    val arrived = pollUntil { grantOf(accountState.value) != before }
                    _state.update {
                        it.copy(
                            notice = when (arrived) {
                                true -> Notice.ARRIVED
                                false -> Notice.SLOW
                                null -> null
                            },
                        )
                    }
                }
            }
        }
    }

    /** Restores the store's purchases (the subscription) for the signed-in account. */
    fun restore(): Job? {
        val gateway = gateway ?: return null
        val current = _state.value
        if (current.restoring || !isReady(current)) return null
        _state.update { it.copy(restoring = true, restoreNotice = null) }
        return scope.launch {
            val outcome = try {
                gateway.restore()
            } finally {
                _state.update { it.copy(restoring = false) }
            }
            when (outcome) {
                RestoreOutcome.Failed -> _state.update { it.copy(restoreNotice = RestoreNotice.FAILED) }
                is RestoreOutcome.Restored -> {
                    val active = outcome.customer.subscriptionActive
                    _state.update {
                        it.copy(
                            subscriptionInStore = active,
                            restoreNotice = if (active) RestoreNotice.DONE else RestoreNotice.NONE,
                        )
                    }
                    if (active) pollUntil { subscriptionOf(accountState.value) != null } else refreshAccount()
                }
            }
        }
    }

    /**
     * Re-reads /me after each delay until [done]; true when it was, false
     * after the last try, null when the session ended meanwhile.
     */
    private suspend fun pollUntil(done: () -> Boolean): Boolean? {
        for (wait in pollDelaysMs) {
            delay(wait)
            if (accountState.value !is Account.State.SignedIn) return null
            refreshAccount()
            if (done()) return true
        }
        return false
    }

    companion object {
        /** About ten seconds in all: the webhook's grant usually lands within a few. */
        val POLL_DELAYS_MS = listOf(1_000L, 1_500L, 2_000L, 2_500L, 3_000L)

        private fun entitlementOf(state: Account.State): Entitlement? = (state as? Account.State.SignedIn)?.me?.entitlement

        private fun subscriptionOf(state: Account.State): SubscriptionView? = entitlementOf(state)?.subscription

        /** What a grant changes: the balance or the subscription. */
        private fun grantOf(state: Account.State): Pair<Int, SubscriptionView?>? =
            entitlementOf(state)?.let { it.credits to it.subscription }

        /** The store has the subscription but the server does not yet. */
        fun subscriptionPending(state: State, entitlement: Entitlement?): Boolean =
            state.subscriptionInStore && entitlement != null && entitlement.subscription == null
    }
}

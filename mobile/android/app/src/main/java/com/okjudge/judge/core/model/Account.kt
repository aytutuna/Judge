package com.okjudge.judge.core.model

import kotlinx.serialization.Serializable

/** Sign-in methods the deployment offers right now (AuthProviders in lib/account-types.ts). */
@Serializable
data class SignInProviders(
    val apple: Boolean = false,
    val google: Boolean = false,
    /** Email magic link: the website's flow, not used by the app. */
    val email: Boolean = false,
    /** Email one-time code: the app's email flow. */
    val emailCode: Boolean = false,
    val dev: Boolean = false,
)

/** GET /api/v1/config, the parts the app reads. */
@Serializable
data class ServerConfig(
    val signIn: SignInProviders = SignInProviders(),
    val premiumEnabled: Boolean = false,
)

@Serializable
data class Viewer(
    val id: String,
    val email: String,
    val name: String = "",
    val image: String? = null,
)

@Serializable
data class SubscriptionView(
    val source: String = "",
    val productId: String = "",
    val periodStart: String = "",
    val periodEnd: String = "",
    val willRenew: Boolean = false,
    val used: Int = 0,
    val cap: Int = 0,
)

@Serializable
data class Entitlement(
    val canUsePremium: Boolean = false,
    val blockedReason: String? = null,
    val credits: Int = 0,
    val subscription: SubscriptionView? = null,
    val resetsAt: String? = null,
) {
    /** The web's planOf: a subscription or any credits make the plan Premium. */
    val isPremium: Boolean get() = subscription != null || credits > 0
}

/** GET /api/v1/me. Both null when the request carried no valid session. */
@Serializable
data class MeResponse(
    val user: Viewer? = null,
    val entitlement: Entitlement? = null,
)

/** The `{token, user}` body of a successful Better Auth sign-in. */
@Serializable
data class SessionGrant(
    val token: String,
    val user: GrantUser? = null,
) {
    @Serializable
    data class GrantUser(val id: String = "", val email: String = "", val name: String? = null)
}

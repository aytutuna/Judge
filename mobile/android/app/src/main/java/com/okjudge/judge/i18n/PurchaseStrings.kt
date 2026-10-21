package com.okjudge.judge.i18n

import android.content.Context
import android.content.res.Configuration
import android.content.res.Resources
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import com.okjudge.judge.R

/**
 * Store purchase copy (res/values/strings_purchases.xml). Kept apart from
 * the generated [Strings] until the shared exporter carries these keys.
 */
class PurchaseStrings(private val res: Resources) {
    val buying: String get() = res.getString(R.string.purchase_buying)
    val success: String get() = res.getString(R.string.purchase_success)
    val pending: String get() = res.getString(R.string.purchase_pending)
    val slow: String get() = res.getString(R.string.purchase_slow)
    val failed: String get() = res.getString(R.string.purchase_failed)
    val restore: String get() = res.getString(R.string.purchase_restore)
    val restoreDone: String get() = res.getString(R.string.purchase_restore_done)
    val restoreNone: String get() = res.getString(R.string.purchase_restore_none)

    companion object {
        fun of(context: Context, lang: AppLang): PurchaseStrings {
            val config = Configuration(context.resources.configuration).apply { setLocale(lang.locale) }
            return PurchaseStrings(context.createConfigurationContext(config).resources)
        }
    }
}

/** [PurchaseStrings] in the app's language ([LocalLang]), not the process locale. */
@Composable
fun rememberPurchaseStrings(): PurchaseStrings {
    val lang = LocalLang.current
    val context = LocalContext.current
    return remember(lang, context) { PurchaseStrings.of(context, lang) }
}

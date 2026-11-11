package com.okjudge.judge.ui.components

import android.os.Build
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.imeNestedScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.input.nestedscroll.NestedScrollConnection
import androidx.compose.ui.input.nestedscroll.NestedScrollSource
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.unit.Velocity
import androidx.compose.ui.unit.dp
import kotlin.math.abs

/** A tap that lands on nothing else takes the focus, and the keyboard with it, away from the text box. */
@Composable
fun Modifier.clearFocusOnTap(): Modifier {
    val focus = LocalFocusManager.current
    return pointerInput(focus) { detectTapGestures { focus.clearFocus() } }
}

/**
 * Pulling a page down with the keyboard up moves the keyboard with the finger and puts it away
 * once it is pulled far enough, as in Messages. Before Android 11 the keyboard can't follow, so it
 * goes only after a clear drag. Goes above the scrolling container.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun Modifier.dragDismissesKeyboard(): Modifier {
    if (Build.VERSION.SDK_INT >= 30) return imeNestedScroll()
    val focus = LocalFocusManager.current
    val threshold = with(LocalDensity.current) { 72.dp.toPx() }
    val connection = remember(focus, threshold) {
        object : NestedScrollConnection {
            var travelled = 0f

            override fun onPreScroll(available: Offset, source: NestedScrollSource): Offset {
                if (source != NestedScrollSource.UserInput) return Offset.Zero
                travelled += available.y
                if (abs(travelled) > threshold) {
                    focus.clearFocus()
                    travelled = 0f
                }
                return Offset.Zero
            }

            override suspend fun onPreFling(available: Velocity): Velocity {
                travelled = 0f
                return Velocity.Zero
            }
        }
    }
    return nestedScroll(connection)
}

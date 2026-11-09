package com.okjudge.judge.ui.components

import androidx.compose.foundation.ScrollState
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.interaction.DragInteraction
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalFocusManager
import kotlinx.coroutines.flow.filterIsInstance

/** A tap that lands on nothing else takes the focus, and the keyboard with it, away from the text box. */
@Composable
fun Modifier.clearFocusOnTap(): Modifier {
    val focus = LocalFocusManager.current
    return pointerInput(focus) { detectTapGestures { focus.clearFocus() } }
}

/** Dragging the page puts the keyboard away. Only the user's drag counts: the page also scrolls by itself to keep the caret in view. */
@Composable
fun ClearFocusOnDrag(scroll: ScrollState) {
    val focus = LocalFocusManager.current
    LaunchedEffect(scroll) {
        scroll.interactionSource.interactions.filterIsInstance<DragInteraction.Start>().collect { focus.clearFocus() }
    }
}

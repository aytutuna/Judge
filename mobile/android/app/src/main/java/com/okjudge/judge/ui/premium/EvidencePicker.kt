package com.okjudge.judge.ui.premium

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.okjudge.judge.core.display.Errors
import com.okjudge.judge.core.evidence.EvidenceItem
import com.okjudge.judge.core.evidence.EvidenceState
import com.okjudge.judge.core.evidence.EvidenceStatus
import com.okjudge.judge.core.evidence.ImageSource
import com.okjudge.judge.core.evidence.UriImageSource
import com.okjudge.judge.i18n.LocalLang
import com.okjudge.judge.i18n.LocalStrings
import com.okjudge.judge.ui.components.JudgeIcons
import com.okjudge.judge.ui.components.TintedIcon
import com.okjudge.judge.ui.theme.JudgeShapes
import com.okjudge.judge.ui.theme.JudgeType
import com.okjudge.judge.ui.theme.Palette

object EvidenceTags {
    const val ADD = "evidence.add"
    fun item(n: Int) = "evidence.item.$n"
    fun status(n: Int) = "evidence.status.$n"
    fun remove(n: Int) = "evidence.remove.$n"
}

/**
 * Opens the system Photo Picker for up to [room] images and hands the picks
 * over as [ImageSource]s (prepared off the main thread when uploaded).
 */
@Composable
fun rememberEvidencePicker(room: Int, onPicked: (List<ImageSource>) -> Unit): () -> Unit {
    val context = LocalContext.current
    val picked by rememberUpdatedState(onPicked)
    val toSources = { uris: List<android.net.Uri> ->
        if (uris.isNotEmpty()) picked(uris.map { UriImageSource(context.contentResolver, it) })
    }
    // The multi-select contract needs room for at least two.
    val many = rememberLauncherForActivityResult(ActivityResultContracts.PickMultipleVisualMedia(maxOf(2, room))) { toSources(it) }
    val one = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri -> toSources(listOfNotNull(uri)) }
    return remember(room) {
        {
            val request = PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)
            if (room <= 1) one.launch(request) else many.launch(request)
        }
    }
}

/**
 * Screenshot evidence (components/case/EvidencePicker.tsx): the picked
 * images with their reading status, a preview of what was read (for the
 * uploader only), remove buttons, the add button and the privacy hint.
 * Stateless: [onAdd] opens the picker.
 */
@Composable
fun EvidencePicker(
    state: EvidenceState,
    disabled: Boolean,
    onAdd: () -> Unit,
    onRemove: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val s = LocalStrings.current
    val lang = LocalLang.current
    val single = state.max == 1
    val announce = state.items.joinToString(". ") { "${s.evidenceThumb(it.n.toString())}: ${s.text(it.status.key) ?: it.status.raw}" }
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text(s.evidenceLabel, style = JudgeType.slotTitle, modifier = Modifier.weight(1f))
            Text("${state.items.size} / ${state.max}", style = JudgeType.footnote)
        }
        state.items.forEach { item -> ItemRow(item, disabled, onRemove) }
        val canAdd = !disabled && !state.full
        Row(
            Modifier
                .defaultMinSize(minHeight = 44.dp)
                .clip(JudgeShapes.chip)
                .border(1.dp, Palette.line2, JudgeShapes.chip)
                .background(Palette.paper)
                .alpha(if (canAdd) 1f else 0.5f)
                .clickable(enabled = canAdd, role = Role.Button, onClick = onAdd)
                .testTag(EvidenceTags.ADD)
                .padding(horizontal = 16.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            TintedIcon(remember { JudgeIcons.plus(Palette.ink) }, 14)
            Text(if (single) s.evidenceAddOne else s.evidenceAdd, style = JudgeType.small.copy(color = Palette.ink))
        }
        Row(verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            TintedIcon(remember { JudgeIcons.lock(Palette.muted) }, 12, Modifier.padding(top = 2.dp))
            Text(if (single) s.evidenceHintOne else s.evidenceHint(state.max), style = JudgeType.slotText)
        }
        if (state.overLimit) Text(s.evidenceLimit, style = JudgeType.slotText.copy(color = Palette.ink2))
        state.failure?.let {
            Text(Errors.message(it, s, lang), style = JudgeType.slotText.copy(color = Palette.danger))
        }
        Box(Modifier.size(1.dp).semantics { liveRegion = LiveRegionMode.Polite; contentDescription = announce })
    }
}

@Composable
private fun statusText(status: EvidenceStatus): String = LocalStrings.current.text(status.key) ?: status.raw

@Composable
private fun ItemRow(item: EvidenceItem, disabled: Boolean, onRemove: (String) -> Unit) {
    val s = LocalStrings.current
    val name = s.evidenceThumb(item.n.toString())
    var open by rememberSaveable(item.id) { mutableStateOf(false) }
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(Palette.paper)
            .border(1.dp, Palette.line, RoundedCornerShape(16.dp))
            .testTag(EvidenceTags.item(item.n))
            .padding(10.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            val thumb = item.thumb
            Box(
                Modifier.size(48.dp).clip(RoundedCornerShape(10.dp)).background(Palette.ivory2),
                contentAlignment = Alignment.Center,
            ) {
                if (thumb != null) {
                    Image(
                        remember(thumb) { thumb.asImageBitmap() },
                        contentDescription = name,
                        contentScale = ContentScale.Crop,
                        modifier = Modifier.size(48.dp),
                    )
                } else {
                    TintedIcon(remember { JudgeIcons.image(Palette.muted) }, 20)
                }
            }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Text(name, style = JudgeType.slotTitle)
                StatusLine(item.status, Modifier.testTag(EvidenceTags.status(item.n)))
            }
            Box(
                Modifier
                    .size(40.dp)
                    .clip(JudgeShapes.chip)
                    .semantics {
                        role = Role.Button
                        contentDescription = s.evidenceRemove(item.n.toString())
                    }
                    .clickable(enabled = !disabled) { onRemove(item.id) }
                    .testTag(EvidenceTags.remove(item.n)),
                contentAlignment = Alignment.Center,
            ) { TintedIcon(remember { JudgeIcons.close(Palette.ink2) }, 14) }
        }
        val preview = item.preview
        if (item.status == EvidenceStatus.OK && preview != null) {
            Text(
                (if (open) "▾ " else "▸ ") + s.evidencePreview,
                style = JudgeType.slotText.copy(color = Palette.ink2, fontWeight = FontWeight.SemiBold),
                modifier = Modifier.clip(RoundedCornerShape(6.dp)).clickable(role = Role.Button) { open = !open }.padding(vertical = 4.dp),
            )
            if (open) {
                Text(s.evidencePreviewNote, style = JudgeType.slotText)
                Text(
                    preview,
                    style = JudgeType.slotText.copy(color = Palette.ink, fontFamily = FontFamily.Monospace, fontSize = 12.sp),
                    modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(Palette.ivory).padding(10.dp),
                )
            }
        }
    }
}

@Composable
private fun StatusLine(status: EvidenceStatus, modifier: Modifier) {
    val color = when (status) {
        EvidenceStatus.OK -> Palette.sageInk
        EvidenceStatus.READING -> Palette.muted
        else -> Palette.terraInk
    }
    Row(modifier.semantics(mergeDescendants = true) {}, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        if (status == EvidenceStatus.READING) CircularProgressIndicator(Modifier.size(11.dp), color = Palette.muted, strokeWidth = 1.5.dp)
        Text(statusText(status), style = JudgeType.slotText.copy(color = color, fontWeight = FontWeight.Medium))
    }
}

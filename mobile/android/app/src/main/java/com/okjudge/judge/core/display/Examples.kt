package com.okjudge.judge.core.display

import com.okjudge.judge.i18n.Strings
import kotlin.random.Random

/** The cases "Try an example" writes in (app.example.* in the shared strings): a on your side, b on theirs. */
object Examples {
    val ids = listOf("dishwasher", "bill", "thermostat", "roadTrip", "seat", "spoiler", "jacket", "lastSlice")

    data class Example(val myName: String, val mine: String, val theirName: String, val theirs: String)

    fun of(id: String, s: Strings) = Example(
        myName = s.text("app.example.$id.aName").orEmpty(),
        mine = s.text("app.example.$id.a").orEmpty(),
        theirName = s.text("app.example.$id.bName").orEmpty(),
        theirs = s.text("app.example.$id.b").orEmpty(),
    )

    /** Any example but [last], so another tap always changes the text. */
    fun pick(last: String?, random: Random = Random.Default): String = ids.filter { it != last }.random(random)
}

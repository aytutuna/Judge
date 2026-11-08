package com.okjudge.judge.ui

import org.junit.Assert.assertEquals
import org.junit.Test

class AvatarImageTest {
    @Test
    fun smallPictureIsNotShrunk() {
        assertEquals(1, sampleSize(100, 100, 128))
        assertEquals(1, sampleSize(200, 200, 128))
    }

    @Test
    fun hugePictureStaysAboveTarget() {
        assertEquals(16, sampleSize(4000, 3000, 128))
        assertEquals(2, sampleSize(256, 1000, 128))
    }
}

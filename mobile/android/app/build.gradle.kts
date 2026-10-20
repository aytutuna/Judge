plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.ksp)
    alias(libs.plugins.room)
    alias(libs.plugins.roborazzi)
}

/** A `judge.*` Gradle property as a Java string literal for BuildConfig. */
fun judgeProp(name: String, fallback: String = ""): String {
    val value = (findProperty("judge.$name") as String?)?.trim().orEmpty().ifEmpty { fallback }
    return "\"" + value.replace("\\", "\\\\").replace("\"", "\\\"") + "\""
}

val productionApi = "https://okjudge.com"

android {
    namespace = "com.okjudge.judge"
    compileSdk = 37

    defaultConfig {
        applicationId = "com.okjudge.judge"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    buildTypes {
        debug {
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
            resValue("string", "launcher_name", "Judge (debug)")
            buildConfigField("String", "API_BASE_URL", judgeProp("apiBaseUrl", productionApi))
            buildConfigField("String", "SHARE_BASE_URL", judgeProp("shareBaseUrl"))
            buildConfigField("String", "TURNSTILE_SITE_KEY", judgeProp("turnstileSiteKey"))
        }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            resValue("string", "launcher_name", "Judge")
            buildConfigField("String", "API_BASE_URL", "\"$productionApi\"")
            buildConfigField("String", "SHARE_BASE_URL", "\"$productionApi\"")
            buildConfigField("String", "TURNSTILE_SITE_KEY", judgeProp("turnstileSiteKey"))
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        buildConfig = true
        compose = true
        resValues = true
    }

    testOptions {
        unitTests {
            isIncludeAndroidResources = true
            all { test ->
                test.systemProperty("robolectric.logging.enabled", "false")
                // The live API check only runs when asked for explicitly.
                (findProperty("judge.liveCheck") as String?)?.let { test.systemProperty("judge.liveCheck", it) }
                test.systemProperty("judge.liveBaseUrl", (findProperty("judge.liveBaseUrl") as String?) ?: productionApi)
                (findProperty("judge.shotsDir") as String?)?.let { test.systemProperty("judge.shotsDir", it) }
                test.maxHeapSize = "3g"
                // Robolectric reaches into JDK internals that JDK 25 closes by default.
                test.jvmArgs(
                    "--add-opens=java.base/java.io=ALL-UNNAMED",
                    "--add-opens=java.base/java.lang=ALL-UNNAMED",
                    "--add-opens=java.base/java.util=ALL-UNNAMED",
                    "--add-opens=java.base/java.nio=ALL-UNNAMED",
                    "--add-opens=java.base/sun.nio.ch=ALL-UNNAMED",
                    "--add-exports=java.base/jdk.internal.access=ALL-UNNAMED",
                    "--add-opens=java.base/jdk.internal.access=ALL-UNNAMED",
                    "--enable-native-access=ALL-UNNAMED",
                )
            }
        }
    }

    sourceSets {
        getByName("test") {
            // Golden data exported from the web code (mobile/shared/fixtures).
            resources.srcDir("../../shared/fixtures")
        }
    }

    // The language toggle switches resources at runtime, so every install
    // needs both locales: no per-language splits in app bundles.
    bundle {
        language {
            enableSplit = false
        }
    }

    lint {
        // "ayrı ayrı" and similar Turkish reduplication in the shared copy is intended.
        disable += "Typos"
    }

    packaging {
        resources.excludes += setOf("/META-INF/{AL2.0,LGPL2.1}", "/META-INF/LICENSE*")
    }
}

room {
    schemaDirectory("$projectDir/schemas")
}

// A release build without the Turnstile site key would ship with the bot check
// off, and every verdict would fail once the server enforces Turnstile. Fail
// the release packaging tasks instead of building that APK or bundle.
val releaseTurnstileKey = providers.gradleProperty("judge.turnstileSiteKey").map { it.trim() }.orElse("")
val checkReleaseTurnstileKey by tasks.registering {
    val key = releaseTurnstileKey
    doLast {
        if (key.get().isEmpty()) {
            throw GradleException(
                "judge.turnstileSiteKey is empty: release builds need the public Turnstile site key " +
                    "(pass -Pjudge.turnstileSiteKey=... or set it in ~/.gradle/gradle.properties).",
            )
        }
    }
}
tasks.matching { it.name == "packageRelease" || it.name == "packageReleaseBundle" }.configureEach {
    dependsOn(checkReleaseTurnstileKey)
}

dependencies {
    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.ui.graphics)
    implementation(libs.compose.ui.text)
    implementation(libs.compose.foundation)
    implementation(libs.compose.material3)
    implementation(libs.compose.ui.tooling.preview)
    debugImplementation(libs.compose.ui.tooling)
    debugImplementation(libs.compose.ui.test.manifest)

    implementation(libs.activity.compose)
    implementation(libs.lifecycle.viewmodel.compose)
    implementation(libs.lifecycle.runtime.compose)
    implementation(libs.lifecycle.viewmodel.navigation3)
    implementation(libs.navigation3.runtime)
    implementation(libs.navigation3.ui)
    implementation(libs.core.ktx)
    implementation(libs.core.splashscreen)
    implementation(libs.browser)
    implementation(libs.webkit)

    implementation(libs.room.runtime)
    implementation(libs.room.ktx)
    ksp(libs.room.compiler)
    implementation(libs.datastore.preferences)

    implementation(libs.okhttp)
    implementation(libs.okhttp.coroutines)
    implementation(libs.serialization.json)
    implementation(libs.coroutines.android)

    testImplementation(libs.junit)
    testImplementation(libs.robolectric)
    testImplementation(libs.androidx.test.core)
    testImplementation(libs.androidx.test.ext.junit)
    testImplementation(libs.coroutines.test)
    testImplementation(libs.turbine)
    testImplementation(libs.mockwebserver)
    testImplementation(platform(libs.compose.bom))
    testImplementation(libs.compose.ui.test.junit4)
    testImplementation(libs.roborazzi)
    testImplementation(libs.roborazzi.compose)
    testImplementation(libs.roborazzi.junit.rule)
}

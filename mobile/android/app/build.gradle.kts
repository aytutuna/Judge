import java.util.Base64

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

// Public OAuth web client id: Google issues the ID token for this audience,
// and the server accepts it. Not a secret.
val googleWebClientId = "173777773521-gumchqdjf6oud3gp4cb27jeqsmf157fd.apps.googleusercontent.com"

// Upload key: CI passes the keystore base64-encoded in env vars; a developer
// machine can set judge.upload* in ~/.gradle/gradle.properties instead. With
// neither, release builds stay unsigned.
fun uploadSetting(env: String, prop: String): String? =
    (System.getenv(env) ?: findProperty(prop) as String?)?.trim()?.ifEmpty { null }

val uploadKeystoreFile: File? = run {
    val b64 = uploadSetting("JUDGE_UPLOAD_KEYSTORE_BASE64", "judge.uploadKeystoreBase64")
    val path = uploadSetting("JUDGE_UPLOAD_KEYSTORE_FILE", "judge.uploadKeystoreFile")
    when {
        b64 != null -> layout.buildDirectory.file("upload-keystore.jks").get().asFile.also {
            it.parentFile.mkdirs()
            it.writeBytes(Base64.getMimeDecoder().decode(b64))
        }
        path != null -> file(path)
        else -> null
    }
}
val uploadStorePassword = uploadSetting("JUDGE_UPLOAD_KEYSTORE_PASSWORD", "judge.uploadStorePassword")
val uploadKeyAlias = uploadSetting("JUDGE_UPLOAD_KEY_ALIAS", "judge.uploadKeyAlias")
val uploadKeyPassword = uploadSetting("JUDGE_UPLOAD_KEY_PASSWORD", "judge.uploadKeyPassword") ?: uploadStorePassword
val canSignRelease = uploadKeystoreFile != null && uploadStorePassword != null && uploadKeyAlias != null && uploadKeyPassword != null

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
        buildConfigField("String", "GOOGLE_SERVER_CLIENT_ID", judgeProp("googleServerClientId", googleWebClientId))
        // Public RevenueCat SDK key for Google Play (goog_...). Empty: no store purchases.
        buildConfigField("String", "REVENUECAT_API_KEY", judgeProp("revenuecatApiKey"))
    }

    signingConfigs {
        if (canSignRelease) {
            create("release") {
                storeFile = uploadKeystoreFile
                storePassword = uploadStorePassword
                keyAlias = uploadKeyAlias
                keyPassword = uploadKeyPassword
            }
        }
    }

    buildTypes {
        debug {
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
            resValue("string", "launcher_name", "Judge (debug)")
            buildConfigField("String", "API_BASE_URL", judgeProp("apiBaseUrl", productionApi))
            buildConfigField("String", "SHARE_BASE_URL", judgeProp("shareBaseUrl"))
        }
        release {
            if (canSignRelease) signingConfig = signingConfigs.getByName("release")
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            resValue("string", "launcher_name", "Judge")
            buildConfigField("String", "API_BASE_URL", "\"$productionApi\"")
            buildConfigField("String", "SHARE_BASE_URL", "\"$productionApi\"")
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
    implementation(libs.credentials)
    implementation(libs.credentials.play.services)
    implementation(libs.googleid)
    implementation(libs.revenuecat.purchases)

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

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("org.jetbrains.kotlin.plugin.serialization")
}

android {
    namespace = "com.churchcomms.operator"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.churchcomms.operator"
        minSdk = 30
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        vectorDrawables {
            useSupportLibrary = true
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlin {
        compilerOptions {
            jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
        }
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
    }

    testOptions {
        unitTests {
            isIncludeAndroidResources = true
        }
    }
}

dependencies {
    // 2026.09.00 (Compose 1.12) needs AGP 9.1 and compileSdk 37; stay on the
    // newest Compose BOM that works with AGP 8.13 and compileSdk 36.
    val composeBom = platform("androidx.compose:compose-bom:2026.06.01")

    implementation(composeBom)
    implementation("androidx.activity:activity-compose:1.13.0")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.9.4")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.9.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("org.jmdns:jmdns:3.6.4")

    // One native WebRTC stack only. See docs/webrtc-notes.md and the guard below.
    implementation("io.livekit:livekit-android:2.29.1")

    debugImplementation("androidx.compose.ui:ui-tooling")

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.10.2")
}

/**
 * Native WebRTC guardrail from docs/webrtc-notes.md.
 *
 * The previous mediasoup attempt crashed because two native WebRTC providers
 * ended up in one APK. Fail the build unless the release graph has exactly one.
 */
val nativeWebRtcGroups = setOf(
    "io.github.webrtc-sdk",
    "org.webrtc",
    "io.dyte.mediasoup",
    "com.oney.WebRTCModule",
)

val checkSingleWebRtcProvider by tasks.registering {
    group = "verification"
    description = "Fails when the release runtime classpath has more than one native WebRTC provider."

    doLast {
        val artifacts = configurations.getByName("releaseRuntimeClasspath")
            .resolvedConfiguration
            .resolvedArtifacts
            .map { it.moduleVersion.id }
            .filter { it.group in nativeWebRtcGroups }
            .map { "${it.group}:${it.name}:${it.version}" }
            .distinct()

        if (artifacts.size != 1) {
            throw GradleException(
                "Expected exactly one native WebRTC provider on releaseRuntimeClasspath, " +
                    "found ${artifacts.size}: ${artifacts.joinToString().ifEmpty { "(none)" }}. " +
                    "See docs/webrtc-notes.md.",
            )
        }
        logger.lifecycle("Native WebRTC provider (expected one): ${artifacts.single()}")
    }
}

tasks.named("check") {
    dependsOn(checkSingleWebRtcProvider)
}

tasks.matching { it.name.startsWith("pre") && it.name.endsWith("Build") }.configureEach {
    dependsOn(checkSingleWebRtcProvider)
}

tasks.withType<Test>().configureEach {
    systemProperty(
        "protocol.fixtures.dir",
        rootProject.file("../protocol/fixtures").absolutePath,
    )
}

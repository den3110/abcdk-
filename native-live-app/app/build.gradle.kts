import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("com.google.gms.google-services")
    id("com.google.firebase.crashlytics")
}

val keystorePropertiesFile = rootProject.file("keystore.properties")
val keystoreProperties = Properties()
val hasReleaseSigningConfig = keystorePropertiesFile.exists()

if (hasReleaseSigningConfig) {
    keystorePropertiesFile.inputStream().use(keystoreProperties::load)
}

fun requiredSigningProperty(name: String): String {
    val value = keystoreProperties.getProperty(name)?.trim().orEmpty()
    if (value.isEmpty()) {
        throw GradleException(
            "Missing '$name' in ${keystorePropertiesFile.absolutePath}. " +
                "Copy keystore.properties.example to keystore.properties and fill in your release signing values."
        )
    }
    return value
}

val releaseStoreFilePath = if (hasReleaseSigningConfig) requiredSigningProperty("storeFile") else ""
val releaseStoreFile = if (hasReleaseSigningConfig) rootProject.file(releaseStoreFilePath) else null

if (hasReleaseSigningConfig && (releaseStoreFile == null || !releaseStoreFile.exists())) {
    throw GradleException(
        "Signing storeFile '$releaseStoreFilePath' was not found. " +
            "Update ${keystorePropertiesFile.absolutePath} to point to your production keystore."
    )
}

android {
    namespace = "com.pkt.live"
    compileSdk = 35

    signingConfigs {
        if (hasReleaseSigningConfig) {
            create("release") {
                storeFile = releaseStoreFile
                storePassword = requiredSigningProperty("storePassword")
                keyAlias = requiredSigningProperty("keyAlias")
                keyPassword = requiredSigningProperty("keyPassword")
                enableV2Signing = true
                enableV3Signing = true
            }
        }
    }

    defaultConfig {
        applicationId = "com.pkt.live"
        minSdk = 24
        targetSdk = 35
        versionCode = 9
        versionName = "v1.2026.04.02.009"

        // NDK crash reporting — captures native (JNI/C++) crashes from Pedro RTMP library
        ndk {
            debugSymbolLevel = "FULL"
        }

        buildConfigField("String", "BASE_URL", "\"https://pickletour.vn/api/\"")
        buildConfigField("String", "SOCKET_URL", "\"https://pickletour.vn\"")
        buildConfigField("String", "LIVE_OBSERVER_URL", "\"\"")

        buildConfigField("String", "OAUTH_AUTHORIZATION_ENDPOINT", "\"https://pickletour.vn/oauth/authorize\"")
        buildConfigField("String", "OAUTH_TOKEN_ENDPOINT", "\"https://pickletour.vn/api/api/oauth/token\"")
        buildConfigField("String", "OAUTH_CLIENT_ID", "\"pickletour-live-app\"")
        buildConfigField("String", "OAUTH_REDIRECT_URI", "\"pickletour-live://auth\"")
        buildConfigField("String", "OAUTH_SCOPE", "\"openid profile\"")

        manifestPlaceholders["appAuthRedirectScheme"] = "pickletour-live"
    }

    buildTypes {
        release {
            if (hasReleaseSigningConfig) {
                signingConfig = signingConfigs.getByName("release")
            }
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
        debug {
            isMinifyEnabled = false
            applicationIdSuffix = ".debug"
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        compose = true
        buildConfig = true
        viewBinding = true
    }
}

gradle.taskGraph.whenReady {
    val requiresReleaseSigning = allTasks.any { task ->
        task.path.contains("Release", ignoreCase = true) &&
            !task.path.contains("Debug", ignoreCase = true)
    }
    if (requiresReleaseSigning && !hasReleaseSigningConfig) {
        throw GradleException(
            "Missing ${keystorePropertiesFile.absolutePath}. " +
                "Copy keystore.properties.example to keystore.properties and provide your production keystore before building release."
        )
    }
}

dependencies {
    // Android Core
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.lifecycle:lifecycle-viewmodel-ktx:2.8.7")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.7")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.appcompat:appcompat:1.7.0")

    // Jetpack Compose
    implementation(platform("androidx.compose:compose-bom:2024.12.01"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.compose.ui:ui-tooling-preview")
    debugImplementation("androidx.compose.ui:ui-tooling")

    // Camera RTMP (pedro RootEncoder)
    implementation("com.github.pedroSG94.RootEncoder:library:2.6.7")

    // Network - Retrofit + OkHttp
    implementation("com.squareup.retrofit2:retrofit:2.11.0")
    implementation("com.squareup.retrofit2:converter-gson:2.11.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("com.squareup.okhttp3:logging-interceptor:4.12.0")

    // Socket.IO
    implementation("io.socket:socket.io-client:2.1.1")

    // Image loading - Coil
    implementation("io.coil-kt:coil-compose:2.7.0")

    // DI - Koin
    implementation("io.insert-koin:koin-android:4.0.0")
    implementation("io.insert-koin:koin-androidx-compose:4.0.0")

    // Coroutines
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")

    // Gson
    implementation("com.google.code.gson:gson:2.11.0")

    // OAuth + secure token storage
    implementation("net.openid:appauth:0.11.1")
    implementation("androidx.browser:browser:1.8.0")
    implementation("androidx.security:security-crypto:1.1.0")

    // Firebase
    implementation(platform("com.google.firebase:firebase-bom:33.8.0"))
    implementation("com.google.firebase:firebase-crashlytics-ktx")
    implementation("com.google.firebase:firebase-crashlytics-ndk")
    implementation("com.google.firebase:firebase-analytics-ktx")
}

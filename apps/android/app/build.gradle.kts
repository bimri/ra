plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Where the shell loads Ra's screens from (see gradle.properties). A local `wrangler dev` by default.
val raUrl: String = (project.findProperty("ra.url") as String?) ?: "http://127.0.0.1:8787/"

android {
    namespace = "app.ra"
    compileSdk = 35

    defaultConfig {
        applicationId = "app.ra"
        // The target is a Tecno from about 2018 (Android 8–9), with an updated system WebView.
        minSdk = 24
        targetSdk = 35
        versionCode = 1
        versionName = "0.0.1"
        buildConfigField("String", "RA_URL", "\"$raUrl\"")
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

    buildFeatures {
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

dependencies {
    testImplementation("junit:junit:4.13.2")
}

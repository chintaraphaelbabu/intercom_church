pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
        // LiveKit Android pulls AudioSwitch from a JitPack commit.
        maven("https://jitpack.io")
    }
}

rootProject.name = "ChurchCommsOperator"
include(":app")

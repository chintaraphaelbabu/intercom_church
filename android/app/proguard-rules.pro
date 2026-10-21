# LiveKit keeps its JNI bridge; do not minify it if R8 is enabled later.
-keep class io.livekit.android.** { *; }
-keep class io.github.webrtc.** { *; }
-dontwarn io.livekit.android.**

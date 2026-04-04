# ProGuard rules for Pickletour Live

# Keep data models for Gson serialization
-keep class com.pkt.live.data.model.** { *; }

# Retrofit
-keepattributes Signature
-keepattributes *Annotation*
-dontwarn retrofit2.**
-keep class retrofit2.** { *; }

# OkHttp
-dontwarn okhttp3.**
-dontwarn okio.**
-keep class okhttp3.** { *; }

# Socket.IO
-keep class io.socket.** { *; }
-dontwarn io.socket.**

# Gson
-keep class com.google.gson.** { *; }
-keepclassmembers class * {
    @com.google.gson.annotations.SerializedName <fields>;
}

# Pedro RootEncoder
-keep class com.pedro.** { *; }
-dontwarn com.pedro.**

# Koin
-keep class org.koin.** { *; }

# Coil
-keep class coil.** { *; }

# Compose
-dontwarn androidx.compose.**

# Firebase Crashlytics — Fix #7: Keep rules for readable stack traces in release
-keep class com.google.firebase.** { *; }
-dontwarn com.google.firebase.**
-keep class com.google.android.gms.** { *; }
-dontwarn com.google.android.gms.**
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

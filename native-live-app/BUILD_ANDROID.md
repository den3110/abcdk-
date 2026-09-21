# Build APK Android (native-live-app)

## Yêu cầu
- **JDK 17** (đã có qua brew: `/opt/homebrew/opt/openjdk@17`)
- **Android SDK** commandline tools (đã có: `/opt/homebrew/share/android-commandlinetools`, platforms 34/35/36)

## Lệnh build (debug APK)
```bash
cd native-live-app
export JAVA_HOME=/opt/homebrew/opt/openjdk@17
export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
export ANDROID_SDK_ROOT=$ANDROID_HOME
./gradlew :app:assembleDebug -x lint
```
APK: `app/build/outputs/apk/debug/app-debug.apk` → `adb install -r <apk>`

## GOTCHA đã fix (lý do trước đây "không build được")
1. **JDK**: máy mặc định JDK 11 → AGP 8/Kotlin 2.1 cần **JDK 17** (set JAVA_HOME như trên).
2. **Firebase**: debug có `applicationIdSuffix=".debug"` → `google-services.json` phải có
   client `com.pkt.live.debug` (đã thêm; bản debug tái dùng app_id của release — chỉ ảnh hưởng
   analytics/FCM của bản debug, không sao cho test).
3. **Disk**: build dex ngốn vài GB — máy phải còn trống ≥3GB.

## Release APK (ký số)
Xem `RELEASE_SIGNING.md` (cần keystore + mật khẩu của chủ dự án).

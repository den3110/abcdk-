# Pickletour Live Release Signing

1. Copy `keystore.properties.example` to `keystore.properties`.
2. Place your production keystore on this machine and set `storeFile` relative to `native-live-app/`.
3. Build the signed release APK with `.\gradlew.bat assembleRelease`.
4. The signed artifact should be written to `app/build/outputs/apk/release/app-release.apk`.
5. Verify it with `apksigner verify --verbose --print-certs app/build/outputs/apk/release/app-release.apk`.
6. Upload that exact APK to your download host and update the CMS field `contact.apps.apkPickleTour`.
7. Remove any debug-signed `com.pkt.live` install from test devices before installing the production-signed APK.

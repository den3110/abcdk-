#!/bin/sh

set -e

GSP_PATH="${TARGET_BUILD_DIR}/${UNLOCALIZED_RESOURCES_FOLDER_PATH}/GoogleService-Info.plist"
RUN_SCRIPT_PATH="${PODS_ROOT}/FirebaseCrashlytics/run"

if [ "${ENABLE_PREVIEWS}" = "YES" ]; then
  exit 0
fi

if [ ! -f "$GSP_PATH" ]; then
  echo "warning: Skipping Crashlytics dSYM upload because GoogleService-Info.plist is missing from the app bundle."
  exit 0
fi

if [ ! -x "$RUN_SCRIPT_PATH" ]; then
  echo "warning: Skipping Crashlytics dSYM upload because FirebaseCrashlytics/run was not found. Run pod install first."
  exit 0
fi

"$RUN_SCRIPT_PATH"

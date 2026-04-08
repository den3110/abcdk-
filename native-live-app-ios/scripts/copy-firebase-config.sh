#!/bin/sh

set -e

SOURCE_CONFIG="${PROJECT_DIR}/PickleTourLive/GoogleService-Info.plist"
DEST_CONFIG="${TARGET_BUILD_DIR}/${UNLOCALIZED_RESOURCES_FOLDER_PATH}/GoogleService-Info.plist"

if [ ! -f "$SOURCE_CONFIG" ]; then
  echo "warning: PickleTourLive Firebase config missing at $SOURCE_CONFIG. Crashlytics will stay disabled for this build."
  exit 0
fi

mkdir -p "$(dirname "$DEST_CONFIG")"
ditto "$SOURCE_CONFIG" "$DEST_CONFIG"


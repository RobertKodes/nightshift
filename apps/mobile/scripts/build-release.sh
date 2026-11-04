#!/bin/bash
# Play Store bundle (AAB) signed with the owner's upload key. The keystore lives outside git; this script never creates one
# (scripts/make-upload-key.ps1 does, once). Run it from the short build folder after scripts/sync-build-dir.sh.
# The key is read from %USERPROFILE%\.nightshift-android\upload.properties, or from these env vars:
#   NIGHTSHIFT_UPLOAD_STORE_FILE      absolute path to the upload keystore (.jks / .keystore)
#   NIGHTSHIFT_UPLOAD_KEY_ALIAS       key alias inside it
#   NIGHTSHIFT_UPLOAD_STORE_PASSWORD  keystore password
#   NIGHTSHIFT_UPLOAD_KEY_PASSWORD    key password (often the same)
# Usage: scripts/build-release.sh [--apk]   (--apk also builds a signed universal APK for sideload testing)
source "$(dirname "$0")/env.sh"
PROPS="$(cygpath -u "${USERPROFILE:-$HOME}" 2>/dev/null || echo "$HOME")/.nightshift-android/upload.properties"
if [ -z "${NIGHTSHIFT_UPLOAD_STORE_FILE:-}" ] && [ -f "$PROPS" ]; then
  prop() { grep -m1 "^$1=" "$PROPS" | cut -d= -f2- | tr -d '\r'; }
  export NIGHTSHIFT_UPLOAD_STORE_FILE="$(prop storeFile)" NIGHTSHIFT_UPLOAD_KEY_ALIAS="$(prop keyAlias)"
  export NIGHTSHIFT_UPLOAD_STORE_PASSWORD="$(prop storePassword)" NIGHTSHIFT_UPLOAD_KEY_PASSWORD="$(prop keyPassword)"
fi
for v in NIGHTSHIFT_UPLOAD_STORE_FILE NIGHTSHIFT_UPLOAD_KEY_ALIAS NIGHTSHIFT_UPLOAD_STORE_PASSWORD NIGHTSHIFT_UPLOAD_KEY_PASSWORD; do
  if [ -z "${!v:-}" ]; then echo "missing $v: run scripts/make-upload-key.ps1 once, or set the env vars (see the header of this script)" >&2; exit 1; fi
done
if [ ! -f "$NIGHTSHIFT_UPLOAD_STORE_FILE" ]; then echo "keystore not found: $NIGHTSHIFT_UPLOAD_STORE_FILE" >&2; exit 1; fi

# every upload needs a higher build number: minutes since 2026-09-01, always rising
export NIGHTSHIFT_VERSION_CODE="${NIGHTSHIFT_VERSION_CODE:-$(( ($(date +%s) - 1788220800) / 60 ))}"
# the release talks to the live engine, never a development one
unset EXPO_PUBLIC_API_URL
echo "versionCode $NIGHTSHIFT_VERSION_CODE"

CI=1 npx expo prebuild -p android --clean --no-install
cd android
# Passwords go to Gradle as injected signing properties, never written into the project files.
SIGN=(
  "-Pandroid.injected.signing.store.file=$NIGHTSHIFT_UPLOAD_STORE_FILE"
  "-Pandroid.injected.signing.store.password=$NIGHTSHIFT_UPLOAD_STORE_PASSWORD"
  "-Pandroid.injected.signing.key.alias=$NIGHTSHIFT_UPLOAD_KEY_ALIAS"
  "-Pandroid.injected.signing.key.password=$NIGHTSHIFT_UPLOAD_KEY_PASSWORD"
)
TASKS=(bundleRelease)
if [ "${1:-}" = "--apk" ]; then TASKS+=(assembleRelease); fi
./gradlew "${TASKS[@]}" "${SIGN[@]}" --console=plain
echo "AAB: $(pwd)/app/build/outputs/bundle/release/app-release.aab"
if [ "${1:-}" = "--apk" ]; then echo "APK: $(pwd)/app/build/outputs/apk/release/app-release.apk"; fi

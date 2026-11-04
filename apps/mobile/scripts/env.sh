#!/bin/bash
# Shared build environment. Reuses the Android SDK already on this PC; override with NIGHTSHIFT_ANDROID_HOME if it moves.
set -euo pipefail
export ANDROID_HOME="${NIGHTSHIFT_ANDROID_HOME:-C:\\Users\\ropet\\Desktop\\sursamobilpc\\SOLSTONESv2\\toolchains\\android-sdk}"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export JAVA_HOME="${NIGHTSHIFT_JAVA_HOME:-${JAVA_HOME:-C:\\Program Files\\Eclipse Adoptium\\jdk-21.0.12.101-hotspot}}"
MOBILE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SDK_UNIX="$(cygpath -u "$ANDROID_HOME" 2>/dev/null || echo "$ANDROID_HOME")"
export PATH="$SDK_UNIX/platform-tools:$SDK_UNIX/emulator:$PATH"

# Windows path limit: the C++ builds (react-native-screens, worklets) nest the full source path inside their
# object folders, which passes 260 characters from this deep repo path. NIGHTSHIFT_BUILD_DIR points the build at
# a short real folder instead (a subst drive or junction does not work: React Native's autolinking resolves real paths).
if [ -n "${NIGHTSHIFT_BUILD_DIR:-}" ]; then MOBILE_DIR="$NIGHTSHIFT_BUILD_DIR"; fi
cd "$MOBILE_DIR"

#!/bin/bash
# Debug APK for the emulator (x86_64 only, so it builds fast). Usage: scripts/build-debug.sh [--clean] [--all-abis]
source "$(dirname "$0")/env.sh"
ABIS=x86_64
CLEAN=0
for a in "$@"; do
  case "$a" in
    --clean) CLEAN=1 ;;
    --all-abis) ABIS=armeabi-v7a,arm64-v8a,x86,x86_64 ;;
  esac
done
if [ "$CLEAN" = 1 ] || [ ! -d android ]; then
  CI=1 npx expo prebuild -p android --clean --no-install
fi
cd android
./gradlew assembleDebug -PreactNativeArchitectures="$ABIS" --console=plain
echo "APK: $(pwd)/app/build/outputs/apk/debug/app-debug.apk"

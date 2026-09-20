#!/usr/bin/env bash
# Builds a release APK and signs it with a self-signed ("ad-hoc") key for sideloading.
# The keystore is created once and lives OUTSIDE the repo; keep it, because Android only
# accepts updates signed with the same key.
#
#   JAVA_HOME=<jdk17> ANDROID_HOME=<sdk> ./sign-release.sh [output.apk]
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
KS_DIR="${PIXELATOR_KEYSTORE_DIR:-$HERE/../../pixelator-signing}"
SDK="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
OUT="${1:-$HERE/../dist/Pixelator-1.0.0.apk}"
BT="$(ls -d "$SDK"/build-tools/* | sort -V | tail -1)"

mkdir -p "$KS_DIR"; chmod 700 "$KS_DIR"
if [ ! -f "$KS_DIR/pixelator.jks" ]; then
  openssl rand -hex 16 > "$KS_DIR/pixelator.pass"; chmod 600 "$KS_DIR/pixelator.pass"
  keytool -genkeypair -keystore "$KS_DIR/pixelator.jks" -alias pixelator -keyalg RSA -keysize 2048 \
    -validity 10000 -dname "CN=Pixelator, O=Solo Apps Studio" \
    -storepass "$(cat "$KS_DIR/pixelator.pass")" -keypass "$(cat "$KS_DIR/pixelator.pass")"
  chmod 600 "$KS_DIR/pixelator.jks"
  echo "Created new keystore in $KS_DIR"
fi

(cd "$HERE" && node sync.js && npx cap sync android)
(cd "$HERE/android" && ./gradlew assembleRelease --no-daemon -q)

mkdir -p "$(dirname "$OUT")"
ALIGNED="$(mktemp -t pixelator-aligned).apk"; rm -f "$ALIGNED"
"$BT/zipalign" -p -f 4 "$HERE/android/app/build/outputs/apk/release/app-release-unsigned.apk" "$ALIGNED"
"$BT/apksigner" sign --ks "$KS_DIR/pixelator.jks" --ks-key-alias pixelator \
  --ks-pass "file:$KS_DIR/pixelator.pass" --out "$OUT" "$ALIGNED"
rm -f "$ALIGNED"
"$BT/apksigner" verify --print-certs "$OUT" | head -3
echo "Signed APK: $OUT"

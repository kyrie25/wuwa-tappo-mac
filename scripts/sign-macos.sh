#!/bin/bash
set -euo pipefail

# Release-only identity import. No login-keychain or system trust changes.
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="${1:?Usage: bash scripts/sign-macos.sh app-path}"
cd "$ROOT"
: "${WUWA_CODESIGN_P12:?Persistent signing certificate is required}"
: "${WUWA_CODESIGN_PASSWORD:?Signing certificate password is required}"
IDENTIFIER=$(node --input-type=module -e 'import { getRegionProfile } from "./scripts/regions.mjs"; console.log(getRegionProfile().identifier)' )
ACTUAL=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$APP/Contents/Info.plist")
test "$ACTUAL" = "$IDENTIFIER"
FINGERPRINT=$(/usr/bin/openssl x509 -in "$ROOT/src-tauri/codesign.pem" -noout -fingerprint -sha1 | /usr/bin/sed 's/.*=//;s/://g')
REQUIREMENT="identifier \"$IDENTIFIER\" and certificate leaf = H\"$FINGERPRINT\""

umask 077
STAGE=$(mktemp -d "${TMPDIR:-/tmp}/wuwa-codesign.XXXXXX")
KEYCHAIN="$STAGE/signing.keychain-db"
cleanup() {
  /usr/bin/security delete-keychain "$KEYCHAIN" >/dev/null 2>&1 || true
  rm -rf "$STAGE"
}
trap cleanup EXIT
printf '%s' "$WUWA_CODESIGN_P12" | /usr/bin/base64 --decode > "$STAGE/identity.p12"
KEYCHAIN_PASSWORD=$(/usr/bin/openssl rand -hex 32)
/usr/bin/security create-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN"
/usr/bin/security set-keychain-settings -lut 3600 "$KEYCHAIN"
/usr/bin/security unlock-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN"
/usr/bin/security import "$STAGE/identity.p12" -k "$KEYCHAIN" -P "$WUWA_CODESIGN_PASSWORD" -T /usr/bin/codesign >/dev/null
/usr/bin/security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$KEYCHAIN_PASSWORD" "$KEYCHAIN" >/dev/null
/usr/bin/codesign --force --sign "$FINGERPRINT" --keychain "$KEYCHAIN" --timestamp=none \
  --requirements "=designated => $REQUIREMENT" "$APP"
/usr/bin/codesign --verify --deep --strict -R "=$REQUIREMENT" "$APP"
/usr/bin/codesign -d -r- "$APP"

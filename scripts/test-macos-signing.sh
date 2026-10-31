#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
umask 077
STAGE=$(mktemp -d "${TMPDIR:-/tmp}/wuwa-signing-test.XXXXXX")
KEYCHAIN="$STAGE/fixture.keychain-db"
cleanup() {
  /usr/bin/security delete-keychain "$KEYCHAIN" >/dev/null 2>&1 || true
  rm -rf "$STAGE"
}
trap cleanup EXIT
APP="$STAGE/Wuwa Tappo.app"
BINARY="$APP/Contents/MacOS/fixture"
IDENTIFIER=$(node --input-type=module -e 'import { getRegionProfile } from "./scripts/regions.mjs"; console.log(getRegionProfile().identifier)')
mkdir -p "$APP/Contents/MacOS"
cat > "$APP/Contents/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>$IDENTIFIER</string>
<key>CFBundleExecutable</key><string>fixture</string>
<key>CFBundlePackageType</key><string>APPL</string>
</dict></plist>
EOF
compile() {
  clang -Wno-deprecated-declarations -DVERSION="$1" "$ROOT/tests/fixtures/keychain-signing.c" \
    -framework Security -framework CoreFoundation -o "$BINARY"
}
denied() {
  if "$BINARY" read "$KEYCHAIN"; then
    printf '%s\n' 'Unexpected Keychain access by a different identity.' >&2
    exit 1
  else
    test "$?" -eq 3
  fi
}
compile 1
bash scripts/sign-macos.sh "$APP"
FIRST_REQUIREMENT=$(/usr/bin/codesign -d -r- "$APP" 2>&1 | sed -n '/^designated =>/p')
FIRST_HASH=$(/usr/bin/codesign -d --verbose=4 "$APP" 2>&1 | sed -n '/^CDHash=/p')
test -n "$FIRST_REQUIREMENT"
test -n "$FIRST_HASH"
"$BINARY" create "$KEYCHAIN"
compile 2
bash scripts/sign-macos.sh "$APP"
test "$FIRST_REQUIREMENT" = "$(/usr/bin/codesign -d -r- "$APP" 2>&1 | sed -n '/^designated =>/p')"
test "$FIRST_HASH" != "$(/usr/bin/codesign -d --verbose=4 "$APP" 2>&1 | sed -n '/^CDHash=/p')"
"$BINARY" read "$KEYCHAIN"

# The same path and bundle ID with an ad-hoc signature must lose access.
compile 3
/usr/bin/codesign --force --sign - "$APP"
denied

# The same certificate must not grant access across the regional identities.
OTHER_REGION=cn
if [ "${WUWA_REGION:-cn}" = cn ]; then OTHER_REGION=global; fi
OTHER_IDENTIFIER=$(WUWA_REGION="$OTHER_REGION" node --input-type=module -e 'import { getRegionProfile } from "./scripts/regions.mjs"; console.log(getRegionProfile().identifier)')
/usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier $OTHER_IDENTIFIER" "$APP/Contents/Info.plist"
WUWA_REGION="$OTHER_REGION" bash scripts/sign-macos.sh "$APP"
denied
printf '%s\n' 'Stable signing and isolated Keychain upgrade checks passed.'

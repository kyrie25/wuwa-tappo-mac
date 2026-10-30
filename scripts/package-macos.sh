#!/bin/bash
set -Eeuo pipefail

PHASE='Startup'
failed() {
  local status=$?
  printf 'Packaging failed: %s (line %s, exit status %s).\n' "$PHASE" "$1" "$status" >&2
  exit "$status"
}
trap 'failed "$LINENO"' ERR
phase() {
  PHASE="$1"
  printf 'Packaging phase: %s\n' "$PHASE"
}

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP=''
OUTPUT="$ROOT/dist"

usage() {
  printf '%s\n' 'Usage: bash scripts/package-macos.sh [--app app-path] [--output output-directory]'
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --app|--output)
      if [ "$#" -lt 2 ]; then usage >&2; exit 2; fi
      if [ "$1" = --app ]; then APP="$2"; else OUTPUT="$2"; fi
      shift 2
      ;;
    --help) usage; exit 0 ;;
    *) usage >&2; exit 2 ;;
  esac
done

PROFILE=$(node --input-type=module -e '
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
const root = process.argv[1];
const { getRegionProfile } = await import(pathToFileURL(path.join(root, "scripts/regions.mjs")));
const profile = getRegionProfile();
const base = JSON.parse(await readFile(path.join(root, "src-tauri/tauri.conf.json"), "utf8"));
const override = profile.tauriConfig ? JSON.parse(await readFile(path.join(root, profile.tauriConfig), "utf8")) : {};
const config = { ...base, ...override };
const minimum = override.bundle?.macOS?.minimumSystemVersion ?? base.bundle.macOS.minimumSystemVersion;
if (config.identifier !== profile.identifier || config.productName !== profile.productName) throw new Error("Build configuration does not match the service region.");
console.log([profile.productName, profile.identifier, config.version, minimum, profile.region, profile.preparedDir, profile.artifactPrefix, profile.label].join("\t"));
' "$ROOT")
IFS=$'\t' read -r PRODUCT_NAME EXPECTED_IDENTIFIER EXPECTED_VERSION EXPECTED_MINIMUM EXPECTED_REGION PREPARED_DIR ARTIFACT_PREFIX REGION_LABEL <<< "$PROFILE"
APP="${APP:-$ROOT/src-tauri/target/release/bundle/macos/$PRODUCT_NAME.app}"

if [ "$(uname -s)" != Darwin ]; then
  printf '%s\n' 'Complete macOS packages must be generated on a Mac.' >&2
  exit 1
fi
if [ ! -d "$APP/Contents" ] || [ ! -f "$APP/Contents/Info.plist" ]; then
  printf '%s\n' 'Complete app not found. Run npm run build first.' >&2
  exit 1
fi

phase 'Read app information'
PLIST="$APP/Contents/Info.plist"
IDENTIFIER=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$PLIST")
EXECUTABLE=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$PLIST")
VERSION=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$PLIST")
MINIMUM=$(/usr/libexec/PlistBuddy -c 'Print :LSMinimumSystemVersion' "$PLIST")
DISPLAY_NAME=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleName' "$PLIST")
if [ "$IDENTIFIER" != "$EXPECTED_IDENTIFIER" ] || [ "$DISPLAY_NAME" != "$PRODUCT_NAME" ] || [ "$VERSION" != "$EXPECTED_VERSION" ] || [ "$MINIMUM" != "$EXPECTED_MINIMUM" ]; then
  printf 'App identifier, name, version or minimum OS requirement does not match the %s build configuration.\n' "$REGION_LABEL" >&2
  exit 1
fi
case "$EXECUTABLE" in
  ''|*/*|.|..) printf '%s\n' 'Invalid app executable name.' >&2; exit 1 ;;
esac
BINARY="$APP/Contents/MacOS/$EXECUTABLE"
phase 'Check architecture and signature'
if [ ! -f "$BINARY" ] || [ "$(/usr/bin/lipo -archs "$BINARY")" != arm64 ]; then
  printf '%s\n' 'Packages must include a native Apple Silicon executable.' >&2
  exit 1
fi
/usr/bin/codesign --verify --deep --strict "$APP"

# Tauri embeds the frontend in the executable; verify build inputs and embedded paths without copying user data.
phase "Check ${REGION_LABEL} embedded resources"
node --input-type=module -e '
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
const [root, binary, preparedDir, region, label] = process.argv.slice(1);
const source = path.join(root, preparedDir);
const index = await readFile(path.join(source, "index.html"), "utf8");
const entry = index.match(/src="\.\/([^\"]+\.js)"/)?.[1];
if (!entry) throw new Error(`Prepared ${label} frontend entry is missing.`);
const main = await readFile(path.join(source, entry), "utf8");
if (!main.includes(`const APP_REGION="${region}"`)) throw new Error(`Package must use the ${label} frontend.`);
const bytes = await readFile(binary);
for (const asset of ["/index.html", `/${entry}`, "/app-icon.png"]) {
  if (!bytes.includes(Buffer.from(asset))) throw new Error(`App is missing required embedded resource: ${asset}`);
}
const contents = await readdir(path.dirname(path.dirname(binary)));
for (const name of ["LICENSE", "THIRD_PARTY_NOTICES.md"]) {
  if (!(await readFile(path.join(path.dirname(path.dirname(binary)), "Resources", name))).length) throw new Error(`Distribution notice is missing: ${name}`);
}
for (const name of ["Library", "Logs", "Caches", "Application Support"]) {
  if (contents.includes(name)) throw new Error(`App must not contain user data directory: ${name}`);
}
' "$ROOT" "$BINARY" "$PREPARED_DIR" "$EXPECTED_REGION" "$REGION_LABEL"

phase 'Create temporary packaging directory'
mkdir -p "$OUTPUT"
OUTPUT="$(cd "$OUTPUT" && pwd)"
STAGE=$(mktemp -d "${TMPDIR:-/tmp}/wuwatappo-package.XXXXXX")
trap 'rm -rf "$STAGE"' EXIT
NAME="$ARTIFACT_PREFIX-$VERSION-arm64"
phase 'Copy app and recheck signature'
ditto --norsrc --noextattr --noqtn --noacl "$APP" "$STAGE/$PRODUCT_NAME.app"
/usr/bin/codesign --verify --deep --strict "$STAGE/$PRODUCT_NAME.app"
phase 'Create ZIP'
ditto -c -k --norsrc --noextattr --noqtn --noacl --keepParent "$STAGE/$PRODUCT_NAME.app" "$STAGE/$NAME.zip"
phase 'Create DMG'
mkdir "$STAGE/dmg"
mv "$STAGE/$PRODUCT_NAME.app" "$STAGE/dmg/"
ln -s /Applications "$STAGE/dmg/Applications"
IMAGE_SIZE_MIB=$(node "$ROOT/scripts/dmg-size.mjs" "$STAGE/dmg")
printf 'DMG filesystem: HFS+; capacity: %s MiB; available host space:\n' "$IMAGE_SIZE_MIB"
df -h "$STAGE" "$OUTPUT"
hdiutil create -fs HFS+ -size "${IMAGE_SIZE_MIB}m" -volname "$PRODUCT_NAME" -srcfolder "$STAGE/dmg" -format UDZO "$STAGE/$NAME.dmg"
phase 'Verify DMG'
hdiutil verify "$STAGE/$NAME.dmg"
phase 'Deliver packages'
mv "$STAGE/$NAME.zip" "$STAGE/$NAME.dmg" "$OUTPUT/"
printf 'Complete %s packages:\n%s\n%s\n' "$REGION_LABEL" "$OUTPUT/$NAME.zip" "$OUTPUT/$NAME.dmg"

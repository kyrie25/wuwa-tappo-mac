# Mac app updates

## User flow

Settings → **Check for Updates** queries this fork’s public GitHub Releases, without a GitHub token. The dialog shows the installed fork version and one of: checking, up to date, update available, no published release, or a retryable failure. Failed requests never become “up to date.” Repeated checks in one window share a pending request; simultaneous checks in another window receive a retry message.

For an available update, **Download DMG** (or ZIP when the DMG is absent) opens the package for the running app’s CN/Global region and Apple Silicon architecture in the browser. **Release Notes** opens that release on GitHub. Quit the app normally before replacing the same regional app in Applications. Keep its bundle identifier unchanged; settings, counters, regional isolation and login-storage preferences stay in their existing locations. The update flow does not clear data, log out, force-quit or restart the app.

Installation is manual. Developer ID signing/notarization is tracked in [issue #3](https://github.com/kyrie25/wuwa-tappo-mac/issues/3). Tauri updater signatures are a separate requirement for any future in-app installer. This implementation creates no updater resource ID and never calls the Windows installer or Tauri updater installation commands.

## Fork release identity

The official resource version (`1.0.3`, for example) is separate from the fork release (`v1.0.3-mac.4`). CI derives `WUWA_FORK_VERSION` from the checked-out release ref and embeds it at Rust compile time. The build script rejects a tag whose base version differs from Cargo’s resource version, malformed revisions, leading zeros and overflow. Tags use `vMAJOR.MINOR.PATCH-mac.REVISION`; all four components compare numerically. `mac.10` follows `mac.9`, and `v1.0.4-mac.1` follows `v1.0.3-mac.99`.

Ordinary branch/source builds omit the release identity. Their dialog says **Development build** and offers the latest published package without claiming an upgrade or an up-to-date state. When reproducing a tagged build locally, check out that tag and export its exact `WUWA_FORK_VERSION` before building. `get_mac_build_info` exposes the fork and resource versions independently.

## Release publishing contract

- Discovery is fixed in the native backend to `kyrie25/wuwa-tappo-mac`, querying the 100 most recent releases. Drafts, GitHub prereleases and tags outside the Mac version format are excluded. The highest numeric valid stable version is selected. Keep the current stable Mac release among these recent releases.
- Uploaded packages must retain `WuwaTappo-CN-Mac-BASE-arm64.dmg` / `.zip` and `WuwaTappo-Global-Mac-BASE-arm64.dmg` / `.zip` names, where BASE matches the tag’s official resource version. Download and release URLs must match this repository and selected tag exactly. Zero-size, unfinished, ambiguous or missing regional packages are explicit errors; an incomplete new release is not silently replaced by an older one.
- Release notes must contain `<!-- wuwa-mac-minimum: 13.0 -->` with the actual minimum supported macOS version. CI’s release notes include it, and a regression test checks it against both regional Tauri configurations. Update both when raising the minimum OS. The dialog hides this metadata line. Legacy tags `v1.0.3-mac.1` through `v1.0.3-mac.3` predate the marker and are known to require macOS 13; newer releases without valid metadata fail compatibility checks.
- Current builds offer Apple Silicon packages only. Unsupported architectures and insufficient/unknown macOS versions produce clear errors before an update is offered.
- Public release publication still depends on both regions passing CI. Publish only the Mac packages; official resource installers remain outside GitHub Releases.

## Implementation and verification

`src-tauri/src/updater.rs` owns fixed-source HTTP discovery, bounded responses, a 15-second timeout, rate-limit errors, numeric comparison, compatibility and package selection. It retains the validated result in memory; the browser-open command accepts an action and the displayed version, never an arbitrary frontend URL. A changed or expired selection requires a fresh check. The compatibility `check_app_update` command ignores the original frontend’s manifest endpoint.

`scripts/mac-updater.js` provides the English download dialog, using the app’s English font, original update background artwork, cream/brown palette and rounded raised buttons. Frontend preparation locates the regional background asset and fails explicitly if that asset contract changes. Frontend preparation replaces the official Windows check/install path and handles its external-download result in Settings. Release notes are displayed as plain text. Official service endpoints used for account/resource synchronization are unchanged.

Rust tests cover version ordering, release filtering, missing metadata, package validation and OS/architecture selection. JavaScript tests exercise the real regional updater patch, error/retry states, request deduplication and safe browser actions. Rendered Settings checks should cover both regions with controlled available/equal/absent/error responses and confirm that no Windows/Tauri installer commands or forced exits occur.

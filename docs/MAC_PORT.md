# macOS port adaptations

This is a native Rust/Tauri port using the official regional frontend and assets. It does not run the Windows application. This guide is the maintenance record for the port: update it or a linked implementation guide whenever an adaptation changes. Describe the reason, code path, behavioral differences, validation and remaining limits. Planned work must remain clearly labeled until implemented and tested.

## Resource compatibility and synchronization

`scripts/sync-upstream.mjs`, `scripts/extract-assets.mjs` and the regional `upstream-*.json` locks obtain and verify official installers, then statically extract the embedded Tauri frontend. Official 1.0.3 changed its NSIS entry from `WuwaTappo.exe` to `$_21_`; extraction now identifies exactly one valid embedded frontend rather than assuming an executable name. It never executes Windows software.

`scripts/inventory-contract.mjs` and `tests/contracts*.json` describe the unmodified regional frontend's native commands/events. A version change requires reviewing contract differences and reconciling native behavior before accepting new snapshots. Preparation fails explicitly when a required patch no longer matches. Compatible sync changes use reviewed PRs; incompatible changes remain drafts. Installer caches are size/SHA-256 verified and are never released as public assets. See [synchronization](SYNCHRONIZATION.md).

## English interface and fork identity

`scripts/english-frontend.mjs` translates app-owned content, including bundled text from modified upstream views. `scripts/prepare-frontend.mjs` applies English defaults and compatibility patches while retaining original artwork/audio and official service endpoints. `scripts/patch-frontend.mjs` handles Mac-specific views and behavior. Native menus, startup/session prompts, About and error messages are English. Service-hosted login pages and announcements can retain their service language.

Repository, issue and Mac distribution links refer to this fork. Original license and asset ownership attribution is retained. Official resource version and fork release revision are distinct; a resource version of 1.0.3 can have multiple Mac revisions.

## Native bridge and regional separation

`src-tauri/src/lib.rs` dispatches the recovered command contract to native modules. `windows.rs`, `system.rs` and `menu.rs` implement desktop windows, transparent pet positioning, monitor/safe-area calculations, click-through, native menus, launch-at-login and diagnostics using macOS/Tauri APIs.

`profile.rs`, `scripts/regions.mjs` and the regional Tauri configurations select CN or Global explicitly. Bundle identifiers, local app data, session/keychain identities, deep-link registration and updater keys remain separate. Packages must match their region; mixed-region binaries/resources are rejected during packaging. Both apps display the name **Wuwa Tappo** and package `Wuwa Tappo.app`; regional bundle IDs and download prefixes stay unchanged, preserving existing data and update routing. Install both in separate folders to avoid a filename collision. A local build of the second region replaces the first region’s build-output bundle; CI builds each region separately. Simultaneous use of identical global shortcuts can conflict.

## Input and shortcuts

[Permission-free tracking](PERMISSION_FREE_INPUT.md) documents the full method and experiments. `input.rs` polls public CoreGraphics ordinary-key counters and uses mouse-only AppKit monitors. It does not request Input Monitoring or Accessibility permission, record typed text or fabricate physical key identities. Burst deltas and wraparound are handled; reset/suspension gaps rebaseline. Modifier-only presses, autorepeat and media keys are excluded. Mouse ownership prevents duplicate native/DOM counting and retains existing pet interactions.

`shortcuts.rs` uses native global shortcut registration independently of global input monitoring. It maps Windows key/modifier data to Mac equivalents, persists regional settings, pauses shortcuts during capture, rejects duplicates and restores registrations after capture/save failures. `scripts/mac-platform.js` supplies Mac platform behavior and modifier labels. F7/F8/F9 can require Fn depending on system keyboard settings.

`gamepad.rs` uses Apple's GameController API for the official controller counting/clap path. This requires physical-controller acceptance; keyboard/mouse tests do not establish controller correctness.

## Login, session storage and counters

`session.rs` and `scripts/mac-session.js` bridge regional cookies and selected authentication storage between local windows. Normal startup now defaults to remembered login in the macOS Keychain without a storage-choice prompt, including users with an old saved memory preference. The loading/error screen offers retry rather than a storage choice. macOS Keychain authorization remains an OS decision. Explicit `--session-only` test launches retain in-memory storage; secure storage is not ordinary plaintext localStorage. Startup/session synchronization barriers and explicit login-ready notifications prevent windows from reading stale login state. CN SDK URLs use HTTPS in the local Tauri origin; Global OAuth uses its registered regional callback. `auth.rs` and frontend preparation preserve the corresponding official flows.

`storage.rs` stores validated numeric counters separately by environment/account, with bounded values and atomic writes. `socket.rs` and `scripts/mac-websocket.js` provide native regional WebSocket connections. Official account, reward and multiplayer rules remain authoritative; local success is not a substitute for real-account testing.

## Fork updates

[Mac updates](MAC_UPDATES.md) documents discovery, signatures, installation, key management and publication. The initial fork updater in mac.4 used browser downloads/manual replacement. The automatic installer adds signed, version-bound regional archives, bounded native downloads, progress, original counter/socket shutdown hooks, session flushing, native bundle replacement and relaunch. It retains the app's English fonts, artwork, brown/cream palette and rounded controls.

Updater cryptographic signatures do not establish Apple Developer ID signing/notarization. That work remains planned in [issue #3](https://github.com/kyrie25/wuwa-tappo-mac/issues/3). The first automatic-updater build requires one manual installation for users on mac.4 or earlier.

## Builds, packaging and release policy

Node is pinned in `.node-version`; Rust is pinned in `rust-toolchain.toml`. GitHub action internals use their own supported runtime independently of the repository Node version. The updater dependency requires Rust 1.90 or newer; the pinned toolchain is newer than that minimum.

`scripts/package-macos.sh` checks bundle identity, architecture, code signature, embedded regional resources and distribution notices. It excludes user directories, builds ZIP/DMG packages and verifies the DMG. DMG capacity uses logical file sizes plus filesystem headroom. Tagged builds additionally create `.app.tar.gz` archives and version-bound signatures. CI must pass both regions before publishing the complete set. Current Apple code signatures are ad-hoc and builds are not notarized.

Standing maintainer rule: release verified app/code/documentation changes by default. Skip releases for purely CI changes or an explicit user instruction. Increment the Mac revision for port changes without changing the official resource version. Publish Mac packages/signatures only; never publish installer resources, signing keys, account data, caches or logs.

## Verification and remaining limits

Run the regional JavaScript contract/behavior suites and native Rust tests, then test the affected rendered/native flow. Tests must exercise the maintained code path rather than merely matching its implementation. Keep temporary probes, screenshots, test identities and fixtures containing private data out of release sources. Public, disposable cryptographic test fixtures contain no retained private key.

The permission-free guide records physical key/left/right/motion observations with both permissions denied. Middle-button delivery, complete pet dragging, secure input, sleep/wake and other macOS versions remain acceptance gaps. Real account reporting, complete Global callback/login, physical controllers, two-player multiplayer and reward actions are not comprehensively verified. Updater validation and its limits are recorded separately in the update guide. Do not convert these limits into claims of verified support without new evidence.

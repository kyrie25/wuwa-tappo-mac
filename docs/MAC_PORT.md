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

`profile.rs`, `scripts/regions.mjs` and the regional Tauri configurations select CN or Global explicitly. Bundle identifiers, local app data, session/keychain identities, deep-link registration and updater keys remain separate. Packages must match their region; mixed-region binaries/resources are rejected during packaging. Both apps display the name **Wuwa Tappo** and package `Wuwa Tappo.app`; this fork uses `io.github.kyrie25.wuwatappo.cn.mac` and `io.github.kyrie25.wuwatappo.global.mac` bundle IDs. The Global OAuth registration name uses the same namespace while its official callback scheme is preserved. Download prefixes and updater public keys remain stable. Install both in separate folders to avoid a filename collision. A local build of the second region replaces the first region’s build-output bundle; CI builds each region separately. Simultaneous use of identical global shortcuts can conflict.

`identity.rs` imports missing regional counters/shortcuts from the old Application Support directory and copies the old WebKit data directory before creating any webviews. Copies are staged before publication; existing destinations and legacy sources are preserved. A completion marker prevents future imports after intentional data deletion. `session.rs` separately imports a validated legacy Keychain snapshot only if the new item is absent and migration has not completed. It writes directly between Keychain items, then records completion without saving credentials in files. Access/write failures leave migration retryable and visible; after migration, logout never falls back to the old item. Original identifiers remain only as compatibility lookup values. Launch-at-login uses the existing executable/app name, so its LaunchAgent path is unchanged. Native fixture tests cover region isolation, existing data, WebKit files, migration repetition, logout and denied Keychain writes. A full real-account upgrade, OS Keychain authorization and WebKit persistence across a production identity change remain hands-on acceptance checks. Quit old app copies before upgrading.

## Input and shortcuts

[Permission-free tracking](PERMISSION_FREE_INPUT.md) documents the full method and experiments. `input.rs` polls public CoreGraphics ordinary-key counters and uses mouse-only AppKit monitors. It does not request Input Monitoring or Accessibility permission, record typed text or fabricate physical key identities. Burst deltas and wraparound are handled; reset/suspension gaps rebaseline. Modifier-only presses, autorepeat and media keys are excluded. Mouse ownership prevents duplicate native/DOM counting and retains existing pet interactions.

`shortcuts.rs` uses native global shortcut registration independently of global input monitoring. It maps Windows key/modifier data to Mac equivalents, persists regional settings, pauses shortcuts during capture, rejects duplicates and restores registrations after capture/save failures. `scripts/mac-platform.js` supplies Mac platform behavior and modifier labels. F7/F8/F9 can require Fn depending on system keyboard settings.

`gamepad.rs` uses Apple's GameController API for the official controller counting/clap path. This requires physical-controller acceptance; keyboard/mouse tests do not establish controller correctness.

## Login, session storage and counters

`session.rs` and `scripts/mac-session.js` bridge regional cookies and selected authentication storage between local windows. Normal startup now defaults to remembered login in the macOS Keychain without a storage-choice prompt, including users with an old saved memory preference. The loading/error screen offers retry rather than a storage choice. macOS Keychain authorization remains an OS decision. Explicit `--session-only` test launches retain in-memory storage; secure storage is not ordinary plaintext localStorage. Startup/session synchronization barriers and explicit login-ready notifications prevent windows from reading stale login state. CN SDK URLs use HTTPS in the local Tauri origin; Global OAuth uses its registered regional callback. `auth.rs` and frontend preparation preserve the corresponding official flows.

`storage.rs` stores validated numeric counters separately by environment/account, with bounded values and atomic writes. `socket.rs` and `scripts/mac-websocket.js` provide native regional WebSocket connections. Official account, reward and multiplayer rules remain authoritative; local success is not a substitute for real-account testing.

## Chest countdowns across sleep

The official frontend measures its server-synchronized clock and newly started chest deadlines with `performance.now()`. On macOS, WebKit excludes system sleep from this clock, so a minute with the lid closed could reduce a countdown by only the few seconds the Mac remained awake.

`patchMacChestClock` in `scripts/patch-frontend.mjs`, applied during frontend preparation for both regions, uses `Date.now()` for those four clock reads. It retains the server timestamp and measures elapsed wall time from the synchronization point; newly started left/right timers use wall-time deadlines too. The existing timer refresh catches up on its first tick after wake, without replaying missed ticks. Animations and performance measurements retain their original clocks. The patch requires unique known upstream anchors and stops preparation if the clock implementation changes.

`tests/chest-countdown.test.mjs` executes the original and prepared countdown functions with independent wall/awake clocks. It reproduces the lost sleep interval, then verifies full elapsed time, repeated sleep cycles, both newly started chest timers, expiry at zero, server resynchronization and login/readiness gates in both regional builds. These are simulated sleep tests; physical lid-close/wake and real account reward claims remain unverified. Manual/system wall-clock adjustments can affect the displayed estimate until server resynchronization. Reward eligibility and claiming remain controlled by the official service.

## Fork updates

[Mac updates](MAC_UPDATES.md) documents discovery, signatures, installation, key management and publication. The initial fork updater in mac.4 used browser downloads/manual replacement. The automatic installer adds signed, version-bound regional archives, bounded native downloads, progress, original counter/socket shutdown hooks, session flushing, native bundle replacement and relaunch. It retains the app's English fonts, artwork, brown/cream palette and rounded controls.

Updater cryptographic signatures do not establish Apple Developer ID signing/notarization. Tagged releases from mac.7 also use a persistent self-signed app certificate so Keychain can recognize later versions by certificate and regional bundle ID. [Stable app signing](MAC_SIGNING.md) documents implementation, credential recovery, isolated Keychain tests and migration limits. Developer ID/notarization remains planned in [issue #3](https://github.com/kyrie25/wuwa-tappo-mac/issues/3). The first automatic-updater build requires one manual installation for users on mac.4 or earlier.

## Builds, packaging and release policy

Node is pinned in `.node-version`; Rust is pinned in `rust-toolchain.toml`. GitHub action internals use their own supported runtime independently of the repository Node version. The updater dependency requires Rust 1.90 or newer; the pinned toolchain is newer than that minimum.

`scripts/package-macos.sh` checks bundle identity, architecture, code signature, embedded regional resources and distribution notices. It excludes user directories, builds ZIP/DMG packages and verifies the DMG. DMG capacity uses logical file sizes plus filesystem headroom. Tagged builds require the pinned self-signed app certificate and additionally create `.app.tar.gz` archives and version-bound updater signatures. CI must pass both regions before publishing the complete set. Ordinary source/PR builds remain ad-hoc signed; releases are not notarized.

Standing maintainer rule: release verified app/code/documentation changes by default. Skip releases for purely CI changes or an explicit user instruction. Increment the Mac revision for port changes without changing the official resource version. Publish Mac packages/signatures only; never publish installer resources, signing keys, account data, caches or logs.

## Verification and remaining limits

Run the regional JavaScript contract/behavior suites and native Rust tests, then test the affected rendered/native flow. Tests must exercise the maintained code path rather than merely matching its implementation. Keep temporary probes, screenshots, test identities and fixtures containing private data out of release sources. Public, disposable cryptographic test fixtures contain no retained private key.

The permission-free guide records physical key/left/right/motion observations with both permissions denied. Middle-button delivery, complete pet dragging, secure input, sleep/wake and other macOS versions remain acceptance gaps. Real account reporting, complete Global callback/login, physical controllers, two-player multiplayer and reward actions are not comprehensively verified. Updater validation and its limits are recorded separately in the update guide. Do not convert these limits into claims of verified support without new evidence.

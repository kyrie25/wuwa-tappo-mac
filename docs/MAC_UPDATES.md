# Mac app updates

## User flow

Settings → **Check for Updates** queries Wuwa Tappo’s public GitHub Releases without a GitHub token. It compares the installed Mac revision and shows checking, up to date, available, no release, development build or retryable failure. Network failures never become “up to date.”

**Update and Restart** downloads the matching signed regional archive inside the app, shows progress and verifies both its bytes and signed app version. Only then does it request persistence/disconnection through the original frontend's bounded shutdown hooks and flush the session. These hooks retain the original timeout and error-reporting behavior; they do not establish real-account persistence acceptance. Native Tauri installation replaces the app bundle and relaunches it. macOS may request administrator approval when the installation location requires it. Failed downloads/signatures never install or restart; save/install failures keep the app open with retry and manual-download controls. Counters, settings and remembered login are retained; the new app-owned regional bundle IDs import data from the corresponding old identity on first launch (see [identity migration](MAC_PORT.md#native-bridge-and-regional-separation)). Normal startup remembers login automatically without a storage-choice prompt. Explicit session-only test launches are in-memory; restarting ends that test session.

**Download DMG/ZIP** and **Release Notes** remain browser actions. The manual flow is also used for older releases without updater archives and for development builds without a release identity. Quit normally before replacing the same regional app in Applications.

Users on mac.4 or earlier must manually install the first automatic-updater release once. Their existing binaries cannot acquire an installer they do not contain. Automatic installation is initiated by **Update and Restart**; checking alone never silently replaces the app.

## Discovery and trust

`src-tauri/src/updater.rs` fixes discovery to `kyrie25/wuwa-tappo-mac` and considers the 100 most recent releases. Drafts, GitHub prereleases and non-Mac tags are excluded; the highest numeric stable Mac version wins. Keep the current stable Mac release in that window. Metadata is limited to 2 MiB with a 15-second timeout. Repeated checks within a window share their pending request; native check/download/install operations are serialized. A new check discards a previously prepared update. Actions must match the displayed version retained by the backend; the frontend cannot supply arbitrary URLs, signatures, keys or installation paths.

Uploaded packages require exact regional names and exact repository/tag HTTPS URLs, uploaded state and nonzero size. Incomplete/ambiguous packages are errors. A bounded 300-second native download allows GitHub's HTTPS asset redirects, checks the exact declared size and limits an archive to 512 MiB and a signature to 16 KiB. Progress events contain only version and byte totals. Verified bytes are retained in memory until installation or the next check; no private download cache is created.

The native Tauri updater is pinned to 2.14.1. `restore_update` builds a native update from the already validated release and requires the signature to bind the announced app version. The package is verified after download and again on install. Separate embedded CN/Global public keys prevent a signed package from the other region being accepted. No updater installation capability is granted to frontend plugin commands; the custom native commands control selection and ordering. The library requires a configured endpoint to construct the updater, so its endpoint is the same fixed release API; installation uses `restore_update`, not the plugin endpoint-check parser. Installation uses the updater's macOS bundle swap/backup/restore implementation; native restart runs normal app cleanup. No custom unsigned replacement script is used.

Updater signatures use project-owned keys and are independent of app code signing. Tagged apps from mac.7 use a [persistent self-signed certificate](MAC_SIGNING.md) and regional designated requirements for Keychain continuity. An initial authorization can be needed when moving from the old identity; later builds retain the same identity. These releases are not notarized or trusted by Gatekeeper. Developer ID signing/notarization remains planned in [issue #3](https://github.com/kyrie25/wuwa-tappo-mac/issues/3).

## App version and compatibility

CI embeds `WUWA_FORK_VERSION` from the exact release ref, separately from Cargo's official resource version. Tags use `vMAJOR.MINOR.PATCH-mac.REVISION`; all four components compare numerically, so mac.10 follows mac.9. The build script rejects malformed/overflowed revisions, leading zeros and resource-version mismatches. Source builds show **Development build** and require manual installation rather than claiming a release identity.

The native Mac version comparator decides eligibility before creating the Tauri update. This is necessary because the resource version remains 1.0.3 while Mac releases such as 1.0.3-mac.5 use a distinct revision. The signature is bound to that full app version, not 1.0.3.

Release notes require `<!-- wuwa-mac-minimum: 13.0 -->` with the actual minimum supported OS. A test checks it against regional configurations; the dialog hides the metadata line. Legacy mac.1–mac.3 have a documented macOS 13 fallback. Newer missing/invalid metadata, unsupported architecture and insufficient/unknown OS versions fail compatibility checks. Only Apple Silicon is currently packaged.

## CI publishing contract

For each region and official BASE version, publish:

- `WuwaTappo-REGION-Mac-BASE-arm64.dmg`
- `WuwaTappo-REGION-Mac-BASE-arm64.zip`
- `WuwaTappo-REGION-Mac-BASE-arm64.app.tar.gz`
- `WuwaTappo-REGION-Mac-BASE-arm64.app.tar.gz.sig`

REGION is `CN` or `Global`; the release has eight files total. DMG/ZIP remain the human installation packages. The archive contains the same verified regional `Wuwa Tappo.app`. Both regions share that display/bundle filename while retaining distinct bundle IDs and package prefixes; co-install them in separate folders. The first manual upgrade from mac.4 or earlier should remove the old regional-named app after quitting it; account data stays under the original regional identity. `scripts/package-macos.sh` signs the archive with Tauri CLI `signer sign --app-version` using the full app version without its leading `v`. Plain `tauri build` would otherwise use the resource version, which would fail the required signed-version check. The `.sig` contains the signed version and signature, never a private key. The existing GitHub release response and signature assets provide updater metadata; no separate hosted update server is required.

The reusable build workflow accepts regional updater secrets, exposed only to packaging, plus the persistent app-signing identity exposed only to tagged signing/tests. Release inherits these through the reusable-workflow secret contract. Ordinary branch/PR builds can test and package ad-hoc DMG/ZIP without access to signing secrets; tagged packaging fails if a key is missing or the app signer is unexpected. Publication checks all eight artifacts after both regional tests/builds/package jobs pass. Official installers must never be uploaded as release assets.

## Publishing from GitHub

Use **Actions → Release → Run workflow**. Leave the tag blank for the next Mac revision, or specify an existing tag to retry it. Supply changelog bullet points unless the tagged source already has a matching prepared release-notes file. The workflow pins the source commit and notes before building both regions; publication waits for tests, signing and all eight packages. A new Mac version-tag push also triggers Release when its prepared notes are committed. Branch/file changes alone do not. Compatible official updates verified and merged by Sync are the sole automatic-release exception; see [synchronization](SYNCHRONIZATION.md#automatic-compatible-updates).

## Key management

Public keys are committed in `src-tauri/updater-cn.pub` and `updater-global.pub`. Protected local private-key backups were created outside the repository under `$HOME/.config/wuwa-tappo-mac/updater-cn.key` and `updater-global.key` (directory mode 0700; files 0600). GitHub Actions secrets are `WUWA_UPDATER_KEY_CN` and `WUWA_UPDATER_KEY_GLOBAL`. Private key material must never enter Git, logs, screenshots, release assets or the knowledge base. Keep a secure maintainer backup; losing a key prevents signing updates trusted by installed builds.

Do not regenerate keys per build. Key rotation requires an update trusted by the existing key that installs the replacement public key, or a manual reinstall. Region keys must stay separate. Recover keys through protected files/secret administration without printing their contents. Updating an app's updater key does not supply Apple signing/notarization credentials.

## Verification

Both CN and Global passed 138 JavaScript tests and 78 Rust tests for the automatic-updater/default-Keychain change on 2026-10-31. Rendered Settings checks passed at desktop and narrow sizes in both regions, including progress, signature failure, retry, manual fallback and shutdown ordering. The startup loading/error view has no storage-choice controls. Isolated CN and Global debug apps also passed real WKWebView startup checks: default Keychain mode, synthetic session write/delete, live app-version discovery, input running without required permission, shortcut save/restore/duplicate rejection and pet layout. Test identities and diagnostics stayed outside release sources.

Rust tests exercise numeric version ordering, filtering, OS/architecture checks, exact regional URLs, complete archive/signature selection, bounded/truncated downloads, real signature verification, wrong keys, signed-version mismatch and tampering. An isolated filesystem test uses the actual Tauri macOS installer to replace a disposable test bundle, confirms tampered bytes leave it unchanged and checks that data outside the bundle survives. Disposable signed fixtures retain only public keys, signatures and test payloads; their private key is deleted.

JavaScript tests and rendered Settings checks cover available/equal/absent/error/development states, progress, duplicate actions, retry/manual fallback and the download → verify → save → install ordering. Native WKWebView checks and release-asset verification are recorded with the release evidence when completed. Full real-account persistence, administrator-authorized replacement, Gatekeeper behavior across macOS releases and recovery from power loss remain distinct acceptance cases; never infer them from a mocked dialog or disposable-bundle test.

## Sources

- [Tauri updater documentation](https://v2.tauri.app/plugin/updater/)
- [Pinned updater implementation](https://docs.rs/tauri-plugin-updater/2.14.1/tauri_plugin_updater/)
- [Port adaptation record](MAC_PORT.md)

## Markdown release notes

`scripts/mac-updater.js` renders notes using the bundled markdown-it parser. Headings, lists, emphasis, code, tables and links use the existing dialog colors/fonts and scrollable notes panel. Raw HTML is escaped and unsafe link schemes are rejected by the parser. Note links use the existing scoped opener permission and open externally. Parser/dependency licenses are packaged with the app. JavaScript behavior tests and a rendered browser check cover formatting, escaping, link actions and narrow/desktop layouts. The app must first update to this revision before subsequent update dialogs render Markdown.

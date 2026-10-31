# Build and maintain Wuwa Tappo

This guide is for developers. For installation, login and updates, use the [user guide](USER_GUIDE.md).

## Prerequisites

- An Apple Silicon Mac with macOS and Xcode Command Line Tools.
- The Node.js version in [`.node-version`](../.node-version), currently **26.13.0**. Select it with your preferred Node version manager.
- [rustup](https://rustup.rs/). The repository's [`rust-toolchain.toml`](../rust-toolchain.toml) selects the Rust version.
- [Homebrew](https://brew.sh/) and 7-Zip (`sevenzip`).

Install the platform tools if needed:

```bash
xcode-select --install
brew install sevenzip
```

Confirm `node --version` matches `.node-version` before installing dependencies.

## Build the CN app

```bash
git clone https://github.com/kyrie25/wuwa-tappo-mac.git
cd wuwa-tappo-mac
npm ci
export WUWA_REGION=cn
npm run setup
npm test
npm run test:rust
npm run build
npm run package
```

CN is the default region; setting it explicitly keeps commands unambiguous.

## Build the Global app

From the same checkout, select Global before preparing, testing and building:

```bash
export WUWA_REGION=global
npm run setup
npm test
npm run test:rust
npm run build
npm run package
```

Set `WUWA_REGION=cn` to switch back. `npm run setup:global` and `npm run build:global` are also available; keep the matching `WUWA_REGION` selected when testing or packaging.

## What setup does

`npm run setup` downloads the installer pinned in [`upstream-cn.json`](../upstream-cn.json) or [`upstream-global.json`](../upstream-global.json), verifies its SHA-256 and size, statically extracts resources, generates icons and prepares the English frontend. It does not execute Windows software or require account login.

To reuse a pinned installer you already downloaded, for example for CN:

```bash
export WUWA_REGION=cn
npm run assets:sync -- --installer "$HOME/Downloads/WuwaTappo-cn_1.0.3_x64-setup.exe"
npm run icons
npm run prepare:frontend
```

Use the installer matching the selected region and resource lock.

## Build outputs and regional identity

| Item | Location |
| --- | --- |
| App bundle | `src-tauri/target/release/bundle/macos/Wuwa Tappo.app` |
| Distribution packages | `dist/` |
| CN extracted resources | `frontend/` |
| Global extracted resources | `frontend-global/` |
| Prepared resources | `build/frontend/` or `build/frontend-global/` |

Extracted resources, generated icons, build outputs and local caches are excluded from Git. Resources are acquired at build time and embedded in the app. Each region has separate prepared assets, icons, configuration and updater keys. Both apps have the same display name.

Regional bundle identifiers are `io.github.kyrie25.wuwatappo.cn.mac` and `io.github.kyrie25.wuwatappo.global.mac`. Existing counters, shortcuts, WebKit settings and Keychain sessions migrate from the old identity once, within the same region, while preserving existing destination data and original recovery data. [The adaptation record](MAC_PORT.md) documents this behavior.

## Tests and implementation notes

Run JavaScript and Rust tests with the same `WUWA_REGION` used to prepare resources. Review [verification limits](USER_GUIDE.md#what-has-been-tested) before describing a feature as fully tested.

- [Mac adaptation record](MAC_PORT.md): native bridge, English preparation, regional separation, storage, shortcuts, sleep-aware countdowns and Gallery loading.
- [Permission-free input](PERMISSION_FREE_INPUT.md): public API method, physical observations and exclusions.
- [Mac updates](MAC_UPDATES.md): discovery, regional version-bound signatures and installation.
- [Stable app signing](MAC_SIGNING.md): certificate management, Keychain continuity and notarization limits.
- [Synchronization](SYNCHRONIZATION.md): extraction failures, contract review and adopting official updates.

Every future macOS adaptation must update the adaptation record or its linked implementation guide. Keep private keys, credentials, account data and personal logs out of source and release packages.

## CI and release publishing

Main-branch pushes and pull requests run regional checks. Each region verifies and extracts official resources, runs JavaScript and Rust tests, builds the native app and packages it. Caches and artifacts are separated by region.

To publish manually, open **Actions → Release → Run workflow** on GitHub. Select the branch to build (normally `main`). Leave **tag** blank to use the next Mac revision, or enter an existing tag to retry that build. Enter changelog bullet points unless a matching versioned notes file is already committed. The workflow validates metadata and notes, creates a missing tag, tests/builds/signs both regions, then publishes all eight Mac packages and signatures. Pushing a new `vBASE-mac.REVISION` tag also triggers Release; commit its prepared notes first. Branch/file changes alone do not trigger Release.

Release only when explicitly requested. Sync has separate authorization to merge compatible official updates and request a release once both regions use the same new version. Do not create an app version for README or documentation edits. Official installer resources must never be published as release assets.

Follow the [release-note rules](../.github/release-notes/README.md): version-only title, Changelog and actionable Instructions, with the required hidden minimum-macOS metadata. Prepared files are read from the exact tagged commit. Otherwise, the manual changelog input supplies Changelog and the workflow adds installation/update Instructions. Correct existing release-note wording in place without producing a new binary release solely for that correction.

## Check for official resource updates

Daily synchronization jobs check each regional service. When the accepted frontend inventory is unchanged apart from its version, Sync updates version metadata and runs compatibility tests, native tests, builds and packaging. Passing candidates are merged automatically with their tested commit pinned. Once CN and Global use the same new official version, Sync dispatches Release; both release builds must pass before publication. Changed contracts or failing checks produce a draft PR and a regional issue, without automatic merging or publication. See [synchronization](SYNCHRONIZATION.md) for details and acceptance limits.

To check and adopt a version locally, select a region first:

```bash
export WUWA_REGION=cn
npm run upstream:check
npm run upstream:update
npm run setup
npm test
npm run test:rust
npm run build
```

Use `WUWA_REGION=global` for Global. Review contract changes before updating snapshots: accepted contract snapshots describe the unmodified official frontend, and English preparation happens afterward. CI caches installers by region and resource lock, and verifies their SHA-256 and size on every reuse.

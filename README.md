# Wuwa Tappo · macOS

[![Build](https://github.com/kyrie25/wuwa-tappo-mac/actions/workflows/ci.yml/badge.svg)](https://github.com/kyrie25/wuwa-tappo-mac/actions/workflows/ci.yml)
[![Download](https://img.shields.io/github/v/release/kyrie25/wuwa-tappo-mac?label=Download)](https://github.com/kyrie25/wuwa-tappo-mac/releases/latest)

**Wuwa Tappo for Mac, in English, for CN and Global accounts.** Uses the official regional interface, characters and services with a native Rust + Tauri backend. No Wine, Windows or virtual machine is required.

This is a community-maintained, **unofficial macOS port**, maintained in [kyrie25/wuwa-tappo-mac](https://github.com/kyrie25/wuwa-tappo-mac). CN and Global are packaged separately and currently pin official version **1.0.3**. English is the default interface language in both builds. Regional accounts and services remain separate.

## Download and use

Choose the `.dmg` for your account's region from [Releases](https://github.com/kyrie25/wuwa-tappo-mac/releases), then drag the app into Applications. Alternatively, extract the corresponding `.zip`. If this fork has no release yet, build from source below.

| Service region | Application | Package prefix |
| --- | --- | --- |
| Mainland China | **Wuwa Tappo CN Mac.app** | `WuwaTappo-CN-Mac` |
| Global | **Wuwa Tappo Global Mac.app** | `WuwaTappo-Global-Mac` |

Both apps can be installed together. Login data, settings, counters and Keychain entries are isolated; account data is not migrated between regions.

- **Requirements:** Apple Silicon (M series), macOS 13 or later. No Intel build is currently provided.
- **Included resources:** Each package includes its regional interface and embedded assets. No separate EXE download or extraction is needed. Login, asset updates and online features require internet access.
- **First launch:** These builds are not notarized by Apple. If macOS blocks the app, verify its source, then use System Settings → Privacy & Security → Open Anyway.
- **Input Monitoring:** Add and enable the app in System Settings → Privacy & Security → Input Monitoring. Authorize each regional app separately, then quit and reopen it as prompted to enable global keyboard and mouse counting.
- **Login:** CN uses the official embedded login; Global uses official browser login with a callback to the app. At startup, choose **This Session Only** or **Remember Login** using macOS Keychain.
- **Language:** App-owned menus, prompts and bundled interface text are English. Login pages, announcements and other content served by Kuro may use the service's language. Character artwork and audio remain the original assets.

Quit the old app before replacing it in Applications. Avoid running multiple copies. If input stops responding after an update, check Input Monitoring, remove the old entry if needed, add the new app and restart it.

## Features and verification status

- Transparent desktop pet, monitor positioning, scaling, always-on-top and click-through.
- Native keyboard/mouse monitoring, permission feedback and recovery after authorization.
- Controller button counting and clap feedback, following official 1.0.3 counting rules.
- Local click counters isolated by app, account and service environment, using the official sync protocol.
- Official regional login, panels, characters and item views.
- Native WebSocket multiplayer connections, room creation and leaving.
- Menu bar controls, launch at login, redacted logs and login session management.
- Configurable global shortcuts: F7 toggles Game Mode, F8 switches screens and F9 toggles the pet by default. Change or clear bindings in Settings. Mac modifier labels use Cmd and Option. Shortcuts pause while recording a replacement. Depending on your keyboard settings, function keys may require Fn.

The upstream project previously verified CN startup, official login, room creation and leaving on a real Mac, and Global startup, About and settings panels. Global browser login, real account callbacks and two-player multiplayer still need hands-on acceptance testing. Input counting requires system authorization. Controller support uses Apple's GameController API and needs a physical controller test. Chest claims, synthesis, redemption codes and multi-monitor combinations have not been comprehensively verified. Rewards use official services; the app does not simulate rewards locally.

The official in-app update service currently distributes Windows installers. Update the Mac app through this repository's Releases.

## Build from source

Requires macOS, Xcode Command Line Tools, Node.js 26.13.0 (pinned in `.node-version`), [rustup](https://rustup.rs/) (the Rust version is pinned in `rust-toolchain.toml`) and 7-Zip.

```bash
xcode-select --install
brew install node sevenzip
git clone https://github.com/kyrie25/wuwa-tappo-mac.git
cd wuwa-tappo-mac
npm ci
npm run setup
npm test
npm run test:rust
npm run build
npm run package
```

The default region is CN. For Global:

```bash
export WUWA_REGION=global
npm run setup
npm test
npm run test:rust
npm run build
npm run package
```

Set `WUWA_REGION=cn` to switch back. Shortcuts such as `npm run setup:global` and `npm run build:global` are also available; select the matching `WUWA_REGION` when running tests.

`setup` downloads the installer pinned in `upstream-cn.json` or `upstream-global.json`, verifies its integrity, statically extracts assets and prepares the English frontend. It never executes Windows software and requires no account login. To reuse a downloaded pinned installer (CN example):

```bash
export WUWA_REGION=cn
npm run assets:sync -- --installer "$HOME/Downloads/WuwaTappo-cn_1.0.3_x64-setup.exe"
npm run icons
npm run prepare:frontend
```

Built apps are under `src-tauri/target/release/bundle/macos/`; distribution packages are under `dist/`. CN uses `frontend/`, Global uses `frontend-global/`, and each has separate prepared assets and icons. Official resources, `build/`, `dist/` and local caches are excluded from Git. Resources are acquired at build time and embedded in the app.

## CI, releases and official version synchronization

- **Commits and pull requests:** Each region independently downloads assets, runs JavaScript and Rust tests, builds the native app and packages ZIP/DMG files. Caches and artifacts are isolated by region.
- **Releases:** A `v*` tag (for example `v1.0.3-mac.1`) runs checks for both regions. All four packages are published in one release only after both pass. Manual releases are also supported.
- **Official synchronization:** Daily jobs check each official service. Compatible updates produce an update PR; extracted versions that need adaptation produce a draft with contract differences and failure logs. Failures create a regional issue. Unverified versions are never automatically released.
- **Resource cache:** CI downloads installers from official sources and caches them by region and resource lock. Every reuse verifies the official SHA-256 and size. Installers are never published as release assets; releases contain the Mac app packages.

Check or synchronize the selected region locally (set `WUWA_REGION=global` for Global):

```bash
npm run upstream:check
npm run upstream:update
npm run setup
npm test
npm run test:rust
npm run build
```

See [synchronization troubleshooting](docs/SYNCHRONIZATION.md) for the 1.0.3 extraction failure and the steps required before adopting a new official version. Accepted contract snapshots describe the unmodified official frontend. Review contract changes before updating those snapshots; English preparation happens afterward.

## Privacy and licensing

Packages contain no maintainer credentials, Keychain contents, account caches, click history or logs. **This Session Only** keeps credentials out of Keychain. **Remember Login** stores them in the system Keychain. Native input monitoring responds to key presses/clicks without recording typed text.

Original macOS backend and adaptation tools use the [MIT License](LICENSE). Official interface, characters, artwork, audio and third-party dependencies retain their original rights and licenses; bundling does **not** relicense them under MIT. See [third-party notices](THIRD_PARTY_NOTICES.md).

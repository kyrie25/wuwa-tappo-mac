# Wuwa Tappo user guide

[Download the latest release](https://github.com/kyrie25/wuwa-tappo-mac/releases/latest) · [Report a problem](https://github.com/kyrie25/wuwa-tappo-mac/issues)

## Which download do I need?

Use an **Apple Silicon Mac** (M series) running **macOS 13 or later**. Intel Macs are not supported.

Choose the DMG or ZIP with **Global** in its name for a Global account, or **CN** for a Mainland China account. Each download includes the app and its regional resources; you do not need to download a Windows installer.

Open the DMG and drag **Wuwa Tappo** into **Applications**. For a ZIP, extract it and move the app there.

> [!IMPORTANT]
> Both regional apps are named `Wuwa Tappo.app`. If you want both, keep them in separate folders, such as `Applications/Wuwa Global/` and `Applications/Wuwa CN/`.

## macOS blocked the app. What do I do?

> [!WARNING]
> These builds are not notarized by Apple. After downloading from this repository's release page and attempting to open the app, use **System Settings → Privacy & Security → Open Anyway** if macOS blocks launch.

Releases use a stable self-signed identity. This helps preserve Keychain access across updates; it does not provide Apple's Gatekeeper trust or notarization. See [app signing](MAC_SIGNING.md) for the details.

## Do I need to sign in?

You can browse the Gallery while signed out. Images that aren't already cached need access to the official image service.

Sign in to use account-dependent features. **Global** opens the official login in your browser and returns to the app. **CN** uses the official embedded login. Accounts and services stay separate between regions.

Normal launches remember login automatically using macOS Keychain. macOS may ask for Keychain access during the initial identity migration or because of your Keychain settings. The app has no startup storage-choice prompt.

## What permissions does counting need?

> [!NOTE]
> Ordinary key presses and supported mouse clicks work without **Input Monitoring** or **Accessibility** permission. Existing grants for counting are unnecessary and can be removed in System Settings.

Held-key repeats, modifier-only presses and media keys do not add keyboard counts. Counting does not keep a typed-text history. See [how permission-free input works](PERMISSION_FREE_INPUT.md) for the method and its limits.

If counting stops after an update, choose **Restart Input Counting** from the app's menu, or restart the app. Avoid running multiple copies at once.

## What are the keyboard shortcuts?

| Shortcut | Action |
| --- | --- |
| F7 | Toggle Game Mode |
| F8 | Move to another screen |
| F9 | Show or hide the pet |

Depending on your keyboard settings, hold **Fn** as well. Change or clear bindings in **Settings**. Shortcuts pause while you record a replacement; Mac modifier labels use **Cmd** and **Option**.

The app also provides pet sizing, display positioning, always-on-top and click-through controls, menu bar controls and launch at login.

## How do I update?

Choose **Settings → Check for Updates → Update and Restart**. The app downloads and verifies the matching regional update, installs it and relaunches. Settings, counters and remembered login are retained.

For a manual update, quit the old app and replace it with the matching DMG or ZIP download.

The `.app.tar.gz` and `.sig` release files are used by the in-app updater. Choose the DMG or ZIP for manual installation. See [the update flow](MAC_UPDATES.md) for technical details.

## Is everything in English?

Bundled interface text, app-owned menus and prompts are English. Login pages, announcements and other content served by Kuro may use the service's language. Character art and audio remain the original assets.

## What needs an internet connection?

Login, synchronization, multiplayer and online account features use official regional services. New or uncached images also require internet access. Rewards and claims are controlled by the official service; the app does not simulate rewards locally.

## What has been tested?

The [Mac adaptation record](MAC_PORT.md) and linked guides record verification for each implementation.

Earlier project testing covered CN startup, official login, room creation and leaving on a real Mac, and Global startup, About and Settings. The permission-free input guide records physical keyboard, left/right mouse and pointer observations. Isolated rendering tests cover public Gallery image loading without an account.

Complete Global browser-login callbacks, two-player multiplayer, physical controller input, middle-button interactions, full pet dragging, chest claims, synthesis, redemption codes and multi-monitor combinations have not been comprehensively verified. Input behavior on other macOS versions and during secure input also has acceptance limits. Treat available controls separately from verified end-to-end support.

## Privacy and licensing

Release packages contain no maintainer credentials, Keychain contents, account caches, personal click history or logs. Normal sessions save login in macOS Keychain. Developers can use `--session-only` for an explicit in-memory test session.

Code uses the [MIT License](../LICENSE). Official art, characters, audio, fonts and other resources retain their owners' rights and are not relicensed under MIT. Read the [third-party notices](../THIRD_PARTY_NOTICES.md).

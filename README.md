![Wuwa Tappo Backpack and desktop pet on macOS](docs/images/wuwa-tappo.png)

<h1 align="center">Wuwa Tappo for Mac</h1>

<p align="center">An English WuWa desktop pet for macOS, with separate CN and Global apps.</p>
<p align="center"><strong><a href="https://github.com/kyrie25/wuwa-tappo-mac/releases/latest">Download</a></strong> · <a href="docs/USER_GUIDE.md">User guide</a> · <a href="https://github.com/kyrie25/wuwa-tappo-mac/issues">Issues</a></p>

## Installation

Requires **Apple Silicon (M series)** and **macOS 13 or later**.

1. Download the DMG from [Releases](https://github.com/kyrie25/wuwa-tappo-mac/releases/latest): **Global** for Global accounts, **CN** for Mainland China accounts.
2. Open the DMG and drag **Wuwa Tappo** into **Applications**.
3. Launch the app.

> [!NOTE]
> Both apps are named `Wuwa Tappo.app`. Install them in separate folders if you use both regions.

## Updates

Choose **Settings → Check for Updates → Update and Restart**. Settings, counters and remembered login are retained.

## Troubleshooting

> [!NOTE]
> These builds are not notarized by Apple. If macOS blocks launch, attempt to open the app, then use **System Settings → Privacy & Security → Open Anyway**.

- **Counting stops:** Choose **Restart Input Counting** from the app's menu, or restart the app. Avoid running multiple copies.
- **Gallery images don't load:** Uncached images require access to the official image service.

See the [user guide](docs/USER_GUIDE.md) for login, language details and verification limits, or [open an issue](https://github.com/kyrie25/wuwa-tappo-mac/issues).

## Input counting and shortcuts

> [!NOTE]
> Ordinary key presses and supported mouse clicks count without Input Monitoring or Accessibility permission. Held-key repeats, modifier-only presses and media keys are excluded.
>
> F7 toggles Game Mode, F8 switches screens and F9 shows or hides the pet. Some keyboards require Fn. Change or clear bindings in Settings.

## Development

[Build from source](docs/BUILDING.md) · [Mac implementation](docs/MAC_PORT.md) · [Input counting](docs/PERMISSION_FREE_INPUT.md)

## Credits and license

Maintained by [kyrie25](https://github.com/kyrie25), building on the original [macOS implementation](https://github.com/Last-emo-boy/wuwa-tappo-mac) and its contributors. Code uses the [MIT License](LICENSE). Official artwork and other resources retain their owners' rights; see [third-party notices](THIRD_PARTY_NOTICES.md).

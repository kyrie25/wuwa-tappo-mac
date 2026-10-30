# Official resource synchronization

This fork's automation checks the official Kuro CN and Global distributions. Repository links, Mac releases and workflow reports belong to [kyrie25/wuwa-tappo-mac](https://github.com/kyrie25/wuwa-tappo-mac). Kuro's service and asset domains remain regional official endpoints.

## October 30, 2026 failure

Both regional synchronization jobs failed while extracting official **1.0.3** because the extractor requested a file named `WuwaTappo.exe`. The new NSIS archive exposes its application payload as an unresolved NSIS variable, `$_21_`, so 7-Zip finished without producing the requested file. Reading it then failed with `ENOENT`.

The extractor now lists the embedded archive, examines candidate executables in memory and requires exactly one valid embedded Tauri frontend. It accepts the old filename and the new NSIS variable name. It never executes the Windows installer. Installer hash/size checks, static import validation and compatibility checks remain in place. Regression tests cover old, renamed, missing and ambiguous payloads. Real Global 1.0.3 extraction was also verified locally.

## Official 1.0.3 compatibility

Both regions now pin official **1.0.3**, with fresh installer SHA-256 hashes and sizes from the official hosts. The compatibility review identified these additions:

| Contract | Additions |
| --- | --- |
| Native commands | `get_app_shortcuts`, `set_app_shortcuts`, `set_shortcut_capture` |
| Events | `app-shortcut`, `app-shortcuts-changed`, `tray-toggle-game-mode` |

The Mac backend implements persistent global shortcut bindings through native hotkey registration. Defaults are F7 for Game Mode, F8 for switching screens and F9 for pet visibility. Recording a replacement temporarily unregisters shortcuts; blur/cancel or closing the recording window restores them. Duplicate bindings are rejected, and an occupied shortcut or failed save preserves the prior configuration. CN and Global keep separate shortcut files. Cmd and Option labels replace Windows modifier labels in the prepared interface.

The native Game Mode menu follows the frontend's current state. The existing desktop safe-area response supplies macOS fullscreen state for the new automatic Game Mode setting. Business API endpoints and regional authentication flows are unchanged.

Frontend preparation now handles the 1.0.3 Settings translator alias and CN's single remaining invoke wrapper. The accepted native and network contract snapshots describe the reviewed, unmodified 1.0.3 bundles; English and Mac adaptations are applied afterward. Login reload, protected Global callbacks, updater feedback and occluded-window layout safeguards remain covered by tests.

For the next official version:

1. Run `npm run upstream:update` separately for `WUWA_REGION=cn` and `WUWA_REGION=global` on a connection that can reach the official hosts.
2. Review `.work/upstream-review/contract-changes.json` and `observed-inventory.json` before updating accepted snapshots. Implement any new commands/events and reconcile version-specific patches and translations.
3. Update application metadata and network contract anchors only after inspecting the actual bundles and manifests.
4. Run JavaScript and Rust tests, native smoke checks, builds and packaging for both regions. Real account login, input authorization, physical keyboard/controller behavior and multiplayer require hands-on acceptance testing.
5. Publish a Mac release from the validated commit.

The sync workflow retains contract differences and validation logs and opens a draft PR when extraction succeeds but compatibility fails. Extraction alone does not establish native compatibility.

## Running automation in this fork

Enable GitHub Actions in the fork and allow GitHub Actions to create and approve pull requests in repository Actions settings. The workflow requires repository contents, pull request and issue write permissions. It uses the current `github.repository` for PRs and reports. It does not need a personal account login or game credentials.

CI downloads resources from the official installer CDN and stores verified installers in GitHub Actions caches. Uncached builds need a working connection to the official CDN. Resources are never published in a separate release; release assets contain only Mac app packages.

## In-app Check for Update

The official update manifest currently contains Windows installers. The Mac app therefore explains in English that no compatible Mac update is available. This is separate from the repository's official resource sync job. Download Mac app updates from [this fork's Releases](https://github.com/kyrie25/wuwa-tappo-mac/releases).

If the issue you are investigating instead concerns account counters, inventory or multiplayer state, reproduce it with the selected region, app version, exact actions and redacted application logs. Never include login tokens or Keychain contents in an issue.

# Input tracking without Input Monitoring

## Implementation

Tappo counts ordinary keyboard presses with CoreGraphics cumulative counters and preserves mouse interactions with mouse-only AppKit event monitors. Neither Input Monitoring nor Accessibility permission is requested or required. The old global keyboard event tap has been removed.

This is the default backend for both CN and Global. Existing permission grants can be removed in System Settings. If counting stops, use **Restart Input Counting** in the app menu. The legacy `request_input_access` command remains for frontend compatibility but only starts the counters.

### Keyboard path

`src-tauri/src/input.rs` samples `CGEventSourceCounterForEventType(kCGEventSourceStateHIDSystemState, kCGEventKeyDown)` every 50 ms. Each delta produces one existing `global-clap-mouse` event. Despite its historical name, the official frontend consumer provides generic clap feedback and updates the ordinary local count through the existing storage, reporting and game-mode gates. No key identity is fabricated and no typed text is collected.

A fresh baseline is taken at startup/recovery, so earlier input is not replayed. Differences use unsigned wrapping subtraction for 32-bit rollover. A sampling gap over two seconds or a delta over 4096 is discarded and rebaselined to avoid replaying activity after suspension or a counter reset. This deliberately drops input during long stalls/sleep.

### Mouse path

`NSEvent` global and local monitors subscribe only to mouse movement, drags and button down/up. The global monitor receives events sent to other apps; the local monitor receives this app’s events and returns each event unchanged. Their delivery scopes do not overlap. No global keyboard monitor is installed.

Mouse locations and left/right/middle button states feed the existing pet hit testing and gesture routing. Main-window native events suppress duplicate trusted DOM mouse events. Auxiliary-window clicks remain owned by their original DOM handler, while a drag keeps the owner of its initial press. Mouse counters are **not** also polled or added to keyboard deltas. Scroll and extra side buttons do not count. Pointer coordinates are used in memory for pet interaction, not stored as click history.

Controller input and configurable global shortcuts retain their separate native implementations. Keyboard shortcuts can still register without a global keyboard event tap.

### Counting limits

- An ordinary key down adds one count. Apple excludes held-key autorepeat from this API.
- Modifier-only presses (Shift, Control, Option, Command, Caps Lock) and media keys are excluded. Aggregate flags-changed totals cannot reliably identify individual modifier presses.
- Key names, key-up ordering and per-key animations are unavailable. Generic clap feedback is used for keyboard counts.
- Counter availability under secure input, remote sessions and other macOS versions has not been comprehensively tested. Requirements remain macOS 13 or later; the permission-denied probes below ran on macOS 27.0.1.
- Existing official account/reporting rules still apply; this change does not establish real-account or multiplayer acceptance.

## Public CoreGraphics API

[`CGEventSourceCounterForEventType`](https://developer.apple.com/documentation/coregraphics/cgeventsource/counterforeventtype(_:eventtype:)) returns a 32-bit cumulative count for an event type since Window Server started. Apple documents that key autorepeat is excluded. Polling counter differences can retain multiple inputs between polls, unlike polling only the time of the last event.

The experiment inspected keyboard and mouse counters. Production uses only the HID system state table’s ordinary key-down counter. Never add the combined-session and HID tables together: they observe overlapping input.

The counters do not expose typed characters, physical key identities, per-event coordinates, timestamps or a complete ordered gesture stream. Modifier changes are separate flags-changed events, including press and release. Media keys have additional limitations documented by Apple. Dividing modifier transitions by two would not establish correct counting across held keys, Caps Lock and sampling boundaries.

## Local experiment: October 31, 2026

The ad-hoc-signed probe ran as a separate LaunchServices application with a distinct bundle identifier. It did not request either permission, create an event tap, install a global event monitor or change TCC settings. It stayed in the background while the user typed and clicked in another app. The probe recorded event-type totals and idle durations, with no key identities, typed text or coordinates.

| Observation over 45 seconds | Combined session | HID system |
| --- | ---: | ---: |
| Ordinary key down | 60 | 60 |
| Ordinary key up | 60 | 60 |
| Modifier transitions | 11 | 10 |
| Left mouse down | 10 | 10 |
| Mouse move | 495 | 495 |
| Input Monitoring granted at start/end | false | false |
| Accessibility granted at start/end | false | false |

One 100 ms sample contained three key-down events, demonstrating that polling did not collapse that burst to a single activity indication. Right/middle clicks, scrolling, deliberate held-key autorepeat, sleep/wake, secure input and other macOS versions were not exercised in this experiment. The observed modifier-table difference reinforces the need to define modifier semantics explicitly.

The local probe source and aggregate output are retained under ignored `.work/input-research/`; they are not app runtime dependencies.

## Mouse-only monitor experiment

A second separately signed background app installed an `NSEvent` global mouse-only monitor. During the user’s 45-second interaction test it received two left-button downs, two left-button ups and 254 mouse-move callbacks. Both permissions remained false at start and end. The requested right click was not observed, so this probe alone does not establish right/middle-button delivery. Its source and aggregate results are also retained in the ignored local research directory.

Apple’s [event monitoring guide](https://developer.apple.com/library/archive/documentation/Cocoa/Conceptual/EventOverview/MonitoringEvents/MonitoringEvents.html) distinguishes global and local scopes and requires Accessibility for global **keyboard** monitoring. The app subscribes only to mouse event types.

## Integrated app test

The actual Tauri/WKWebView CN app was also built with an isolated test bundle identifier and session-only storage, then launched through LaunchServices. Test-only diagnostics confirmed `inputMonitoring=false` and `accessibility=false` at startup. Its native smoke test passed with input `running=true`, `permissionRequired=false`, visible pet layout, synthetic session-cookie round trip, and shortcut save/restore/duplicate rejection.

During a 60-second physical-input window it delivered 74 generic keyboard count events, 15 left-button presses, 16 right-button presses and 415 movement events. These are observed totals, not an independently measured one-for-one physical-input benchmark. Middle-button input and full pet-drag interactions were not physically exercised. Test-only diagnostics/listeners were confined to the temporary build and are absent from release sources.

## Verification and maintenance

Both CN and Global passed 130 JavaScript tests and 74 Rust tests. Rust regression tests cover burst deltas, unchanged snapshots, 32-bit rollover, reset/suspension baselines, supported mouse buttons, duplicate presses, auxiliary-window suppression, drag ownership and display scaling. JavaScript tests check permission-free running status, one-shot automatic recovery, actionable restart guidance and trusted DOM suppression. The native session-only smoke test requires `running: true` and `permissionRequired: false`.

To repeat the permission-denied probes, build a separately signed app with a unique bundle identifier, launch it in the background through LaunchServices, verify both preflight checks are false, and use physical keyboard/mouse input in another app. Record aggregate totals only. Do not reset or modify the user’s TCC grants to manufacture a passing result. Synthetic injected events do not establish physical HID-counter behavior.

When changing this backend, preserve one counting owner for each input source and retain the official frontend’s persistence/reporting gates. Do not sum combined-session and HID counters, count mouse callbacks a second time through aggregate counters, or estimate modifier presses by dividing flags-change totals by two.

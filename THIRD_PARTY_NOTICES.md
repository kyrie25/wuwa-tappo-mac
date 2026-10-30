# Third-party notices

## Wuwa Tappo CN and Global

This project uses interface, character, artwork, audio, font and other embedded resources from the corresponding official regional client. Login and service requests use that region's official services. This content, its names and trademarks belong to Kuro Games and their respective rights holders and are not covered by this repository's MIT License. This fork applies English translations to bundled interface text.

- CN download: https://download-mc-wuwatappo.kurogames-global.com/download/
- Global download: https://download-wutheringwaves-wuwatappo.kurogames-global.com/download/en/
- Pinned versions, download URLs and integrity information: [`upstream-cn.json`](upstream-cn.json), [`upstream-global.json`](upstream-global.json).

Resources are extracted statically at build time and embedded in the application. The source repository contains no personal account data. Use remains subject to the official terms of service. This community project is independent of the official distribution channels.

## Preact

The renderer test code in `tests/fixtures/kuro-sdk-preact.js` uses Preact under the MIT License. Its full copyright and license notice remains at the top of that file.

## Build dependencies

Tauri, Rust crates, Node.js packages and 7-Zip retain their respective licenses. Versions are recorded in `src-tauri/Cargo.lock` and `package-lock.json`. 7-Zip is used only for static extraction during builds and is not distributed with the app.

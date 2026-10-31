# Port maintenance

- Consult the relevant project knowledge in `~/Documents/knowledge-base` before work, and update it when verified findings or user decisions change.
- Preserve unrelated concurrent edits. Re-read files before editing and commit only this task's changes.
- Document every macOS adaptation in `docs/MAC_PORT.md` or its linked implementation guide: purpose, implementation, behavioral differences, validation and remaining limits. Update the documentation alongside future changes.
- After an app/code/documentation change is verified, push it and create the next `vBASE-mac.REVISION` release through the Release workflow. Skip a release only for purely CI changes or when the user explicitly requests otherwise. Do not create another release when no source change is needed.
- Keep CN and Global identities, data and updater signing keys separate. Never commit private signing keys, credentials or user data.
- Keep project documentation limited to public platform APIs and independently verified app behavior. Preserve license attribution and exclude proprietary third-party implementation details.
- Official installer resources must never be published as release assets. Release only Mac distribution/update packages and their signatures.
- Release notes contain only Changelog and Instructions. Instructions must give actionable installation, upgrade or usage steps; behavior explanations belong in Changelog or documentation. Review each bullet's purpose before publishing. Correct existing release notes in place without creating a new binary release solely for that correction.

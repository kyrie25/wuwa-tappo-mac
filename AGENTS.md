# Port maintenance

- Consult the relevant project knowledge in `~/Documents/knowledge-base` before work, and update it when verified findings or user decisions change.
- Preserve unrelated concurrent edits. Re-read files before editing and commit only this task's changes.
- Document every macOS adaptation in `docs/MAC_PORT.md` or its linked implementation guide: purpose, implementation, behavioral differences, validation and remaining limits. Update the documentation alongside future changes.
- Create a release/version tag only when the user explicitly requests it, through a manual GitHub Actions dispatch or a new version-tag push. Branch/file changes alone must not trigger Release. The standing exception is fully validated compatible official-version updates found by Sync: merge them and release automatically once CN and Global align. Ordinary README, documentation, code and CI changes must not create an app version or release. This supersedes the earlier automatic-release-for-every-change policy.
- Keep CN and Global identities, data and updater signing keys separate. Never commit private signing keys, credentials or user data.
- Keep project documentation limited to public platform APIs and independently verified app behavior. Preserve license attribution and exclude proprietary third-party implementation details.
- Official installer resources must never be published as release assets. Release only Mac distribution/update packages and their signatures.
- Release notes contain only Changelog and Instructions. Instructions must give actionable installation, upgrade or usage steps; behavior explanations belong in Changelog or documentation. Review each bullet's purpose before publishing. Correct existing release notes in place without creating a new binary release solely for that correction.

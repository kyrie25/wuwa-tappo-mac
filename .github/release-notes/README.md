# Release notes

Before tagging a release, add `vBASE-mac.REVISION.md` here with that exact tag name. Use only **Changelog** and **Instructions** sections: describe changes introduced by that version, followed by installation, upgrade or usage steps. Keep general feature lists, licensing text, CI reports and validation records in the project documentation.

Retain the hidden `<!-- wuwa-mac-minimum: 13.0 -->` comment with the release’s actual minimum macOS version; the app updater requires it. Release titles contain only the version tag. The publishing workflow reads the matching file and updates the body/title when republishing an existing release. For a manual dispatch, notes come from the selected workflow revision while app packages are built from the supplied version tag.

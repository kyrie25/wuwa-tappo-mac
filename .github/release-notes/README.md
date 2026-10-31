# Release notes

Publish manually through **Actions → Release → Run workflow**. Leave `tag` blank to select the next Mac revision, or enter an existing tag to retry it. Provide changelog bullet points in `changelog`, or commit `.github/release-notes/vBASE-mac.REVISION.md` before running the workflow. Prepared notes are read from the exact source commit selected for the tag and take precedence over the input. A missing changelog and missing prepared file fail before a tag is created.

Use only **Changelog** and **Instructions** sections. Describe changes introduced by that version, followed by actionable installation, upgrade or usage steps. Keep general feature lists, licensing text, CI reports and validation records in project documentation. When no prepared file exists, the workflow formats the supplied changelog as bullets and adds standard installation/update Instructions.

Retain `<!-- wuwa-mac-minimum: 13.0 -->` with the actual minimum macOS version in prepared notes. Release titles contain only the version tag. Both regional metadata versions must agree before releasing. The workflow publishes only after both regional builds succeed, using notes prepared before those builds.

Pushing a new `vBASE-mac.REVISION` tag also triggers Release; commit its prepared notes first. Moving an existing tag does not start a release. Branch/file changes alone do not trigger Release; ordinary README, documentation, code and CI changes do not create an app version. The authorized automatic exception is a compatible new official version verified and merged by Sync; it dispatches Release with a resource-update changelog. Do not create an app version solely for documentation changes.

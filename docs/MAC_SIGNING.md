# Stable macOS app signing

## Purpose and behavior

Starting with mac.7, tagged releases use a persistent project-owned self-signed code-signing certificate. Ad-hoc signing identifies an app by its changing code hash; the new designated requirement identifies it by the exact signing certificate and regional bundle ID. Later versions signed with the same certificate and ID can retain Keychain access. CN and Global remain different identities even though they share a certificate and app name.

This is free macOS code signing, without Developer ID or notarization. It does not establish Gatekeeper trust or remove Open Anyway requirements. [Issue #3](https://github.com/kyrie25/wuwa-tappo-mac/issues/3) still tracks funded Developer ID signing and notarization. The regional Tauri updater keys independently authenticate update archives; they are unchanged.

Moving from an ad-hoc build or the old bundle ID can require an initial Keychain authorization. Allow access to the legacy item to migrate remembered login. Where macOS offers **Always Allow**, that choice persists authorization. Locked Keychains, changed user access policies, certificate/ID changes and manual ad-hoc builds can still prompt or deny access. The app does not bypass these decisions, grant all applications access, install a trusted root or modify system trust settings.

## Implementation

`src-tauri/codesign.pem` is the public certificate, issued to **Wuwa Tappo (kyrie25)** and valid until 2046-10-26. `scripts/sign-macos.sh` imports the private identity into a temporary unlocked build Keychain, grants the signing tool access to that private key, and signs the completed app with an explicit requirement:

```text
identifier "REGIONAL_BUNDLE_ID" and certificate leaf = H"PINNED_CERTIFICATE_SHA1"
```

The certificate fingerprint is read from the committed public certificate; this SHA-1 field is Apple's certificate requirement syntax, not the executable's changing code hash. The script signs with that exact certificate, disables network timestamping, and verifies the result against the requirement. Temporary Keychains and credential copies are deleted on exit, including failures. No login-Keychain import or trust change is required on build or user machines.

The reusable build workflow signs only tagged release builds. Ordinary source/PR builds retain explicit ad-hoc signing without secrets. Tagged packaging independently checks the app's pinned signer and regional identifier before producing distribution/update packages. Missing credentials, an unexpected signer or invalid signatures stop publication. No bundle content is modified after signing.

## Private identity and recovery

GitHub Actions secrets are `WUWA_CODESIGN_P12` (base64 PKCS#12 identity) and `WUWA_CODESIGN_PASSWORD`. They are passed only to the release signing/test step. Protected maintainer backups live outside Git under `$HOME/.config/wuwa-tappo-mac/`: `codesign.p12`, `codesign-password`, `codesign.key` and `codesign.pem`, with directory mode 0700 and private files mode 0600. Keep an encrypted offline backup. Only the public certificate belongs in the repository; private keys/passwords must never enter logs, artifacts, releases or documentation.

Restore the existing identity and password through GitHub's secret administration using standard input, without printing them. Do not regenerate a certificate per build or replace an existing identity during setup. Keeping the same private key but issuing a different certificate changes the pinned requirement too. Certificate replacement/loss/compromise requires a planned transition and may require renewed Keychain authorization; this self-signed identity has no Apple revocation service. Before expiry, plan migration to a replacement identity or funded Developer ID signing. Do not silently update the pin to make a failing release pass.

## Verification

`scripts/test-macos-signing.sh` requires the same signing secrets and runs in each tagged regional CI job before signing the real app. It builds two different disposable app binaries with the same bundle ID/certificate, checks that their code hashes differ and their designated requirements match, and verifies that the second binary can read the first binary's synthetic Keychain item. The fixture uses `SecItemAdd`/`SecItemCopyMatching`, the APIs used by the app's secure-storage library, against an isolated temporary Keychain with UI interaction disabled. An ad-hoc replacement and the other regional identity must both be denied. Fixtures and temporary Keychains are removed afterward; no account data or login-Keychain item is accessed.

Both regional checks passed locally on 2026-10-31: the two stable versions returned OSStatus 0; ad-hoc and cross-region replacements returned -25293. This establishes code-identity continuity in that isolated test. Full real-account migration and behavior under other Keychain policies/macOS versions remain hands-on acceptance checks. Final release apps are checked again after packaging with `codesign --verify --deep --strict` and the pinned requirement.

## Sources

- [Apple TN2206: macOS Code Signing In Depth](https://developer.apple.com/library/archive/technotes/tn2206/_index.html), especially Trust and Code Signing, Code Designated Requirement, and Self-signed Identities.
- [Mac update signatures and key management](MAC_UPDATES.md)
- [Port adaptations and identity migration](MAC_PORT.md)

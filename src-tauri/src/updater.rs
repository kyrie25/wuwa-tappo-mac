use crate::profile::Region;
use serde::{Deserialize, Serialize};
use std::{io::Read, sync::Mutex, time::Duration};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_updater::UpdaterExt;

const REPOSITORY: &str = "https://github.com/kyrie25/wuwa-tappo-mac";
const API: &str = "https://api.github.com/repos/kyrie25/wuwa-tappo-mac/releases?per_page=100";
const MAX_BYTES: u64 = 2 * 1024 * 1024;
const MAX_PACKAGE_BYTES: u64 = 512 * 1024 * 1024;

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
struct Version([u64; 4]);

impl Version {
    fn parse(tag: &str) -> Option<Self> {
        let (base, revision) = tag.strip_prefix('v')?.split_once("-mac.")?;
        let parts = base.split('.').chain(std::iter::once(revision));
        let values: Vec<_> = parts
            .map(|part| {
                if part.is_empty()
                    || !part.bytes().all(|c| c.is_ascii_digit())
                    || (part.len() > 1 && part.starts_with('0'))
                {
                    return None;
                }
                part.parse().ok()
            })
            .collect::<Option<_>>()?;
        Some(Self(values.try_into().ok()?))
    }

    fn base(self) -> String {
        format!("{}.{}.{}", self.0[0], self.0[1], self.0[2])
    }
}

#[derive(Deserialize)]
struct Asset {
    name: String,
    browser_download_url: String,
    state: String,
    size: u64,
}

#[derive(Deserialize)]
struct Release {
    tag_name: String,
    draft: bool,
    prerelease: bool,
    html_url: String,
    body: Option<String>,
    assets: Vec<Asset>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AvailableRelease {
    version: String,
    notes: String,
    release_url: String,
    download_url: String,
    asset_name: String,
    can_install: bool,
    #[serde(skip)]
    package: Option<UpdatePackage>,
}

#[derive(Clone)]
struct UpdatePackage {
    url: String,
    signature_url: String,
    size: u64,
}

struct PreparedUpdate {
    version: String,
    update: tauri_plugin_updater::Update,
    bytes: Vec<u8>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Check {
    status: &'static str,
    current_version: Option<String>,
    resource_version: &'static str,
    release: Option<AvailableRelease>,
}

#[derive(Default)]
pub struct UpdaterState {
    latest: Mutex<Option<Check>>,
    prepared: Mutex<Option<PreparedUpdate>>,
}

pub fn build_info() -> serde_json::Value {
    serde_json::json!({
        "forkVersion": option_env!("WUWA_FORK_VERSION").map(|tag| tag.trim_start_matches('v')),
        "resourceVersion": env!("CARGO_PKG_VERSION"),
    })
}

fn os_version(value: &str) -> Option<[u64; 3]> {
    let parts: Vec<_> = value.trim().split('.').collect();
    if !(1..=3).contains(&parts.len()) {
        return None;
    }
    let mut result = [0; 3];
    for (index, part) in parts.iter().enumerate() {
        if part.is_empty() || !part.bytes().all(|c| c.is_ascii_digit()) {
            return None;
        }
        result[index] = part.parse().ok()?;
    }
    Some(result)
}

fn minimum_os(release: &Release, version: Version) -> Result<[u64; 3], String> {
    let marker = "<!-- wuwa-mac-minimum: ";
    let body = release.body.as_deref().unwrap_or("");
    if let Some((_, tail)) = body.split_once(marker) {
        let value = tail
            .split_once(" -->")
            .ok_or("Invalid minimum macOS release metadata")?
            .0;
        return os_version(value).ok_or("Invalid minimum macOS release metadata".into());
    }
    // These published legacy packages predate the metadata and require macOS 13.
    if version >= Version([1, 0, 3, 1]) && version <= Version([1, 0, 3, 3]) {
        return Ok([13, 0, 0]);
    }
    Err("The release does not declare its minimum macOS version. Open Wuwa Tappo’s Releases to check compatibility.".into())
}

fn select_release(
    releases: &[Release],
    current: Option<&str>,
    region: Region,
    arch: &str,
    os: &str,
) -> Result<Check, String> {
    let installed = current
        .map(|tag| Version::parse(tag).ok_or("Invalid installed app version"))
        .transpose()?;
    let mut result = Check {
        status: "noRelease",
        current_version: current.map(|v| v.trim_start_matches('v').into()),
        resource_version: env!("CARGO_PKG_VERSION"),
        release: None,
    };
    let Some((version, release)) = releases
        .iter()
        .filter(|r| !r.draft && !r.prerelease)
        .filter_map(|r| Version::parse(&r.tag_name).map(|v| (v, r)))
        .max_by_key(|(v, _)| *v)
    else {
        return Ok(result);
    };
    let release_url = format!("{REPOSITORY}/releases/tag/{}", release.tag_name);
    if release.html_url != release_url {
        return Err("Invalid Wuwa Tappo release URL".into());
    }
    result.status = if installed.is_some_and(|v| version <= v) {
        "upToDate"
    } else if installed.is_some() {
        "available"
    } else {
        "development"
    };
    // An equal/older release needs no downloadable compatible asset.
    if result.status == "upToDate" {
        return Ok(result);
    }
    if arch != "aarch64" {
        return Err("No Wuwa Tappo update package is available for this Mac architecture".into());
    }
    let minimum = minimum_os(release, version)?;
    if os_version(os).ok_or("Could not determine this Mac’s macOS version")? < minimum {
        return Err(format!(
            "The latest release requires macOS {}.{} or later. This Mac runs {os}.",
            minimum[0], minimum[1]
        ));
    }
    let label = match region {
        Region::Cn => "CN",
        Region::Global => "Global",
    };
    let mut selected = None;
    for extension in ["dmg", "zip"] {
        let name = format!("WuwaTappo-{label}-Mac-{}-arm64.{extension}", version.base());
        let candidates: Vec<_> = release.assets.iter().filter(|a| a.name == name).collect();
        if candidates.len() > 1 {
            return Err("The release contains ambiguous Mac packages".into());
        }
        if let Some(asset) = candidates.first() {
            let url = format!("{REPOSITORY}/releases/download/{}/{name}", release.tag_name);
            if asset.state != "uploaded" || asset.size == 0 || asset.browser_download_url != url {
                return Err(
                    "The release’s Mac package is incomplete or has an invalid download URL".into(),
                );
            }
            selected = Some((*asset, url));
            break;
        }
    }
    let (asset, url) = selected.ok_or_else(|| format!("The latest release has no complete {label} Apple Silicon Mac package. Try again after publication finishes."))?;
    let package_name = format!("WuwaTappo-{label}-Mac-{}-arm64.app.tar.gz", version.base());
    let package = match (
        trusted_asset(release, &package_name)?,
        trusted_asset(release, &format!("{package_name}.sig"))?,
    ) {
        (Some(package), Some(signature)) if package.size <= MAX_PACKAGE_BYTES && signature.size <= 16 * 1024 => Some(UpdatePackage {
            url: package.browser_download_url.clone(), signature_url: signature.browser_download_url.clone(), size: package.size,
        }),
        (None, None) if version <= Version([1, 0, 3, 4]) => None,
        _ => return Err("The release’s signed updater package is missing or incomplete. Try again after publication finishes.".into()),
    };
    result.release = Some(AvailableRelease {
        version: release.tag_name.trim_start_matches('v').into(),
        notes: release
            .body
            .as_deref()
            .unwrap_or("No release notes were provided.")
            .lines()
            .filter(|line| !line.starts_with("<!-- wuwa-mac-minimum:"))
            .collect::<Vec<_>>()
            .join("\n"),
        release_url,
        download_url: url,
        asset_name: asset.name.clone(),
        can_install: installed.is_some() && package.is_some(),
        package,
    });
    Ok(result)
}

fn trusted_asset<'a>(release: &'a Release, name: &str) -> Result<Option<&'a Asset>, String> {
    let assets: Vec<_> = release.assets.iter().filter(|a| a.name == name).collect();
    if assets.len() > 1 {
        return Err("The release contains ambiguous updater packages".into());
    }
    let Some(asset) = assets.first() else {
        return Ok(None);
    };
    let expected = format!("{REPOSITORY}/releases/download/{}/{name}", release.tag_name);
    if asset.state != "uploaded" || asset.size == 0 || asset.browser_download_url != expected {
        return Err("The release’s updater package is incomplete or has an invalid URL".into());
    }
    Ok(Some(asset))
}

fn http_error(status: u16) -> String {
    match status {
        403 | 429 => {
            "GitHub denied the update check or its rate limit was reached. Try again later.".into()
        }
        _ => format!("Could not check for updates (HTTP {status}). Try again later."),
    }
}

fn fetch_releases() -> Result<Vec<Release>, String> {
    let response = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "Could not initialize the update check")?
        .get(API)
        .header("User-Agent", "wuwa-tappo-mac")
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .send()
        .map_err(|_| "Could not reach GitHub. Check your connection and try again.")?;
    if !response.status().is_success() {
        return Err(http_error(response.status().as_u16()));
    }
    let mut bytes = Vec::new();
    response
        .take(MAX_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "Could not read GitHub’s release response")?;
    if bytes.len() as u64 > MAX_BYTES {
        return Err("GitHub’s release response exceeds the size limit".into());
    }
    serde_json::from_slice(&bytes).map_err(|_| "GitHub returned invalid release metadata".into())
}

pub fn check(app: &AppHandle) -> Result<serde_json::Value, String> {
    let state = app.state::<UpdaterState>();
    let mut latest = state
        .latest
        .try_lock()
        .map_err(|_| "An update check is already in progress. Try again shortly.")?;
    *latest = None;
    *state
        .prepared
        .lock()
        .map_err(|_| "Update state lock failed")? = None;
    let releases = fetch_releases()?;
    let result = select_release(
        &releases,
        option_env!("WUWA_FORK_VERSION"),
        Region::from_app(app),
        std::env::consts::ARCH,
        &crate::system::system_version()?,
    )?;
    *latest = Some(result.clone());
    serde_json::to_value(result).map_err(|e| e.to_string())
}

pub fn open(app: &AppHandle, action: &str, version: &str) -> Result<serde_json::Value, String> {
    let state = app.state::<UpdaterState>();
    let latest = state
        .latest
        .try_lock()
        .map_err(|_| "An update check is in progress")?;
    let release = latest
        .as_ref()
        .and_then(|c| c.release.as_ref())
        .ok_or("Check for an update before opening its download")?;
    if release.version != version {
        return Err(
            "Update information changed. Check for Updates again before downloading.".into(),
        );
    }
    let url = match action {
        "download" => &release.download_url,
        "notes" => &release.release_url,
        _ => return Err("Unknown update action".into()),
    };
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|_| "Could not open the update link in your browser")?;
    Ok(serde_json::Value::Null)
}

pub(crate) fn public_key(region: Region) -> &'static str {
    match region {
        Region::Cn => include_str!("../updater-cn.pub").trim(),
        Region::Global => include_str!("../updater-global.pub").trim(),
    }
}

fn package_client() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(300))
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            let url = attempt.url();
            if attempt.previous().len() < 5
                && url.scheme() == "https"
                && matches!(
                    url.host_str(),
                    Some(
                        "github.com"
                            | "release-assets.githubusercontent.com"
                            | "objects.githubusercontent.com"
                    )
                )
            {
                attempt.follow()
            } else {
                attempt.error("Untrusted update redirect")
            }
        }))
        .build()
        .map_err(|_| "Could not initialize the update download".into())
}

fn read_package(
    mut response: impl Read,
    expected: u64,
    mut progress: impl FnMut(u64),
) -> Result<Vec<u8>, String> {
    if expected == 0 || expected > MAX_PACKAGE_BYTES {
        return Err("Invalid updater package size".into());
    }
    let mut bytes = Vec::new();
    let mut buffer = [0; 64 * 1024];
    loop {
        let count = response
            .read(&mut buffer)
            .map_err(|_| "The update download was interrupted. Try again.")?;
        if count == 0 {
            break;
        }
        if bytes.len() as u64 + count as u64 > expected {
            return Err("The update package exceeds its declared size".into());
        }
        bytes.extend_from_slice(&buffer[..count]);
        progress(bytes.len() as u64);
    }
    if bytes.len() as u64 != expected {
        return Err("The update download is incomplete. Try again.".into());
    }
    Ok(bytes)
}

pub fn download(app: &AppHandle, version: &str) -> Result<serde_json::Value, String> {
    let state = app.state::<UpdaterState>();
    // Keep discovery/browser actions serialized with preparation and installation.
    let latest = state
        .latest
        .try_lock()
        .map_err(|_| "An update operation is already in progress")?;
    let release = latest
        .as_ref()
        .and_then(|c| c.release.as_ref())
        .filter(|r| r.version == version && r.can_install)
        .ok_or("Check for a newer signed update before installing")?;
    *state
        .prepared
        .lock()
        .map_err(|_| "Update state lock failed")? = None;
    let package = release
        .package
        .as_ref()
        .ok_or("No signed updater package is available")?;
    let client = package_client()?;
    let signature = client
        .get(&package.signature_url)
        .send()
        .and_then(|r| r.error_for_status())
        .map_err(|_| "Could not download the update signature. Try again.")?;
    let mut signature_text = String::new();
    signature
        .take(16 * 1024 + 1)
        .read_to_string(&mut signature_text)
        .map_err(|_| "Invalid update signature")?;
    if signature_text.len() > 16 * 1024 {
        return Err("Update signature exceeds the size limit".into());
    }
    let metadata = serde_json::json!({"version": version, "url": package.url, "signature": signature_text.trim()});
    // Fork versions use their own four-component comparator, rather than Cargo's resource version.
    // restore_update requires the signature to bind the announced version as well as the bytes.
    let update = app
        .updater_builder()
        .pubkey(public_key(Region::from_app(app)))
        .version_comparator(|_, _| true)
        .build()
        .map_err(|e| e.to_string())?
        .restore_update(metadata)
        .map_err(|e| e.to_string())?
        .ok_or("No installable update")?;
    let response = client
        .get(&package.url)
        .send()
        .and_then(|r| r.error_for_status())
        .map_err(|_| {
            "Could not download the update package. Check your connection and try again."
        })?;
    let mut last = std::time::Instant::now() - Duration::from_secs(1);
    let bytes = read_package(response, package.size, |downloaded| {
        if last.elapsed() >= Duration::from_millis(100) || downloaded == package.size {
            let _ = app.emit(
                "mac-update-progress",
                serde_json::json!({"version":version,"downloaded":downloaded,"total":package.size}),
            );
            last = std::time::Instant::now();
        }
    })?;
    update
        .verify(&bytes)
        .map_err(|e| format!("Update signature or version verification failed: {e}"))?;
    *state
        .prepared
        .lock()
        .map_err(|_| "Update state lock failed")? = Some(PreparedUpdate {
        version: version.into(),
        update,
        bytes,
    });
    Ok(serde_json::Value::Null)
}

pub fn install(app: &AppHandle, version: &str) -> Result<serde_json::Value, String> {
    let state = app.state::<UpdaterState>();
    let _latest = state
        .latest
        .try_lock()
        .map_err(|_| "An update operation is already in progress")?;
    let prepared = state
        .prepared
        .lock()
        .map_err(|_| "Update state lock failed")?
        .take()
        .filter(|p| p.version == version)
        .ok_or("Download and verify this update before installing")?;
    prepared.update.install(&prepared.bytes).map_err(|e| format!("Could not install the update: {e}. The app will remain open; you can retry or use the manual download."))?;
    app.restart();
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn release(tag: &str) -> Release {
        let base = Version::parse(tag).unwrap().base();
        let assets: Vec<_> = ["CN", "Global"].into_iter().flat_map(|region| ["dmg", "zip", "app.tar.gz", "app.tar.gz.sig"].map(move |ext| (region, ext)))
            .map(|(region, ext)| {
                let name = format!("WuwaTappo-{region}-Mac-{base}-arm64.{ext}");
                json!({"browser_download_url":format!("{REPOSITORY}/releases/download/{tag}/{name}"),"name":name,"state":"uploaded","size":123})
            }).collect();
        serde_json::from_value(json!({"tag_name":tag,"draft":false,"prerelease":false,
            "html_url":format!("{REPOSITORY}/releases/tag/{tag}"),"body":"<!-- wuwa-mac-minimum: 13.0 -->\nRelease notes", "assets":assets})).unwrap()
    }

    fn check(releases: &[Release], current: Option<&str>, region: Region) -> Result<Check, String> {
        select_release(releases, current, region, "aarch64", "13.6.1")
    }

    #[test]
    fn numeric_fork_version_ordering_and_invalid_versions() {
        assert!(Version::parse("v1.0.3-mac.10") > Version::parse("v1.0.3-mac.9"));
        assert!(Version::parse("v1.0.4-mac.1") > Version::parse("v1.0.3-mac.99"));
        for value in [
            "1.0.3",
            "v1.0.3",
            "v1.0.3-mac.01",
            "v1.0.3-mac.-1",
            "v1.0.3-mac.3-dev",
            "v1.0.3.4-mac.1",
            "v1.0.3-mac.18446744073709551616",
        ] {
            assert!(Version::parse(value).is_none(), "{value}");
        }
    }

    #[test]
    fn selects_correct_region_and_prefers_dmg_with_safe_zip_fallback() {
        for (region, label) in [(Region::Cn, "CN"), (Region::Global, "Global")] {
            let mut releases = vec![release("v1.0.3-mac.4")];
            let result = check(&releases, Some("v1.0.3-mac.3"), region).unwrap();
            assert_eq!(result.status, "available");
            assert_eq!(result.current_version.as_deref(), Some("1.0.3-mac.3"));
            let update = result.release.unwrap();
            assert_eq!(
                update.asset_name,
                format!("WuwaTappo-{label}-Mac-1.0.3-arm64.dmg")
            );
            assert!(!update.notes.contains("wuwa-mac-minimum"));
            releases[0].assets.retain(|a| !a.name.ends_with(".dmg"));
            assert!(check(&releases, Some("v1.0.3-mac.3"), region)
                .unwrap()
                .release
                .unwrap()
                .asset_name
                .ends_with(".zip"));
        }
    }

    #[test]
    fn stable_release_selection_is_numeric_and_development_never_claims_up_to_date() {
        let mut releases = vec![
            release("v1.0.3-mac.9"),
            release("v1.0.3-mac.10"),
            release("v2.0.0-mac.1"),
            release("v3.0.0-mac.1"),
        ];
        releases[2].draft = true;
        releases[3].prerelease = true;
        let result = check(&releases, None, Region::Cn).unwrap();
        assert_eq!(result.status, "development");
        assert_eq!(result.release.unwrap().version, "1.0.3-mac.10");
        for current in ["v1.0.3-mac.10", "v1.0.3-mac.11", "v1.0.4-mac.1"] {
            assert_eq!(
                check(&releases, Some(current), Region::Cn).unwrap().status,
                "upToDate"
            );
        }
        assert_eq!(
            check(&[], Some("v1.0.3-mac.3"), Region::Cn).unwrap().status,
            "noRelease"
        );
        assert_eq!(
            check(&releases[2..], None, Region::Cn).unwrap().status,
            "noRelease"
        );
    }

    #[test]
    fn incomplete_wrong_region_windows_and_untrusted_urls_cannot_be_updates() {
        let mut r = release("v1.0.3-mac.4");
        r.assets.retain(|a| a.name.contains("Global"));
        assert!(check(&[r], Some("v1.0.3-mac.3"), Region::Cn).is_err());
        for mutate in [0, 1, 2, 3, 4] {
            let mut r = release("v1.0.3-mac.4");
            r.assets
                .retain(|a| a.name.contains("CN") && a.name.ends_with(".dmg"));
            match mutate {
                0 => r.assets[0].browser_download_url = "https://evil.example/setup.exe".into(),
                1 => r.assets[0].name = "setup.exe".into(),
                2 => r.assets[0].state = "starter".into(),
                3 => r.assets[0].size = 0,
                _ => r.html_url = "https://github.com/other/repo/releases/tag/v1.0.3-mac.4".into(),
            }
            assert!(check(&[r], Some("v1.0.3-mac.3"), Region::Cn).is_err());
        }
        let mut r = release("v1.0.3-mac.4");
        r.assets.push(serde_json::from_value(json!({"name":r.assets[0].name,"browser_download_url":r.assets[0].browser_download_url,"state":"uploaded","size":1})).unwrap());
        assert!(check(&[r], None, Region::Cn).is_err());
    }

    #[test]
    fn architecture_os_and_missing_minimum_metadata_are_explicit_failures() {
        assert!(select_release(
            &[release("v1.0.3-mac.4")],
            None,
            Region::Cn,
            "x86_64",
            "13.0"
        )
        .is_err());
        for os in ["12.7.1", "unknown"] {
            assert!(
                select_release(&[release("v1.0.3-mac.4")], None, Region::Cn, "aarch64", os)
                    .is_err()
            );
        }
        let mut r = release("v1.0.4-mac.1");
        r.body = Some("<!-- wuwa-mac-minimum: 14.1 -->".into());
        assert!(check(&[r], None, Region::Cn).is_err());
        let mut r = release("v1.0.3-mac.4");
        r.body = None;
        assert!(check(&[r], None, Region::Cn).is_err());
        let mut r = release("v1.0.3-mac.3");
        r.body = None;
        assert!(check(&[r], None, Region::Cn).is_ok());
        assert!(serde_json::from_str::<Vec<Release>>("{\"message\":\"rate limited\"}").is_err());
        assert!(serde_json::from_str::<Vec<Release>>("[{\"tag_name\":\"v1.0.3-mac.4\"}]").is_err());
        assert!(http_error(403).contains("rate limit"));
        assert!(http_error(429).contains("rate limit"));
        assert!(http_error(500).contains("HTTP 500"));
    }
    #[test]
    fn automatic_updates_require_a_complete_matching_signed_package() {
        for region in [Region::Cn, Region::Global] {
            let result = check(&[release("v1.0.3-mac.5")], Some("v1.0.3-mac.4"), region).unwrap();
            assert!(result.release.unwrap().can_install);
            assert!(
                !check(&[release("v1.0.3-mac.5")], None, region)
                    .unwrap()
                    .release
                    .unwrap()
                    .can_install
            );
        }
        for mutation in 0..5 {
            let mut r = release("v1.0.3-mac.5");
            let i = r
                .assets
                .iter()
                .position(|a| a.name.contains("CN") && a.name.ends_with(".sig"))
                .unwrap();
            match mutation {
                0 => {
                    r.assets.remove(i);
                }
                1 => {
                    r.assets[i].browser_download_url =
                        "https://github.com/other/repo/update.sig".into()
                }
                2 => r.assets[i].size = 0,
                3 => r.assets[i].size = 16385,
                _ => r.assets[i].state = "starter".into(),
            }
            assert!(check(&[r], Some("v1.0.3-mac.4"), Region::Cn).is_err());
        }
        let mut legacy = release("v1.0.3-mac.4");
        legacy.assets.retain(|a| !a.name.contains("app.tar.gz"));
        assert!(
            !check(&[legacy], Some("v1.0.3-mac.3"), Region::Cn)
                .unwrap()
                .release
                .unwrap()
                .can_install
        );
        assert_ne!(public_key(Region::Cn), public_key(Region::Global));
    }

    #[test]
    fn package_download_requires_exact_bounded_bytes() {
        assert_eq!(read_package(&b"abc"[..], 3, |_| {}).unwrap(), b"abc");
        assert!(read_package(&b"abc"[..], 2, |_| {}).is_err());
        assert!(read_package(&b"ab"[..], 3, |_| {}).is_err());
        assert!(read_package(&b""[..], 0, |_| {}).is_err());
        assert!(read_package(&b""[..], MAX_PACKAGE_BYTES + 1, |_| {}).is_err());
    }

    #[test]
    fn real_updater_verifies_bytes_region_key_and_signed_fork_version() {
        use tauri_plugin_updater::UpdaterExt;
        let mut context = tauri::test::mock_context(tauri::test::noop_assets());
        context.config_mut().plugins.0.insert(
            "updater".into(),
            json!({"pubkey":"","requireSignedVersion":true,"endpoints":[API]}),
        );
        let app = tauri::test::mock_builder()
            .plugin(tauri_plugin_updater::Builder::new().build())
            .build(context)
            .unwrap();
        let payload = include_bytes!("../../tests/fixtures/updates/payload.txt");
        let signature = include_str!("../../tests/fixtures/updates/payload.txt.sig").trim();
        let fixture_key = include_str!("../../tests/fixtures/updates/test.pub").trim();
        for (key, version, valid) in [
            (fixture_key, "1.0.3-mac.5", true),
            (fixture_key, "1.0.3-mac.6", false),
            (public_key(Region::Cn), "1.0.3-mac.5", false),
        ] {
            let update = app.updater_builder().pubkey(key).version_comparator(|_, _| true)
                .executable_path("/tmp/Wuwa Test.app/Contents/MacOS/test").build().unwrap()
                .restore_update(json!({"version":version,"url":"https://github.com/kyrie25/wuwa-tappo-mac/test.tar.gz","signature":signature})).unwrap().unwrap();
            assert_eq!(update.verify(payload).is_ok(), valid);
            assert!(update.verify(b"tampered update").is_err());
        }
    }
    #[test]
    fn signed_archive_replaces_only_the_isolated_app_and_tampering_preserves_it() {
        use std::os::unix::fs::PermissionsExt;
        let mut context = tauri::test::mock_context(tauri::test::noop_assets());
        context
            .config_mut()
            .plugins
            .0
            .insert("updater".into(), json!({"pubkey":"","endpoints":[API]}));
        let app = tauri::test::mock_builder()
            .plugin(tauri_plugin_updater::Builder::new().build())
            .build(context)
            .unwrap();
        let root = std::env::temp_dir().join(format!(
            "wuwa-update-install-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let bundle = root.join("Wuwa Update Test.app");
        let executable = bundle.join("Contents/MacOS/test");
        std::fs::create_dir_all(executable.parent().unwrap()).unwrap();
        std::fs::write(&executable, "old test app").unwrap();
        let data = root.join("counters-and-session-sentinel");
        std::fs::write(&data, "preserve user data").unwrap();
        let update = app.updater_builder().pubkey(include_str!("../../tests/fixtures/updates/test.pub").trim())
            .version_comparator(|_, _| true).executable_path(&executable).build().unwrap()
            .restore_update(json!({"version":"1.0.3-mac.5","url":"https://github.com/kyrie25/wuwa-tappo-mac/test.tar.gz","signature":include_str!("../../tests/fixtures/updates/test.app.tar.gz.sig").trim()})).unwrap().unwrap();
        assert!(update.install(b"tampered archive").is_err());
        assert_eq!(
            std::fs::read_to_string(&executable).unwrap(),
            "old test app"
        );
        update
            .install(include_bytes!(
                "../../tests/fixtures/updates/test.app.tar.gz"
            ))
            .unwrap();
        assert_eq!(
            std::fs::read_to_string(&executable).unwrap(),
            "new test app\n"
        );
        assert_eq!(
            std::fs::read_to_string(&data).unwrap(),
            "preserve user data"
        );
        assert_eq!(
            std::fs::metadata(&bundle).unwrap().permissions().mode() & 0o777,
            0o755
        );
        std::fs::remove_dir_all(root).unwrap();
    }
}

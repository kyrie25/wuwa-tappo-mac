use crate::profile::Region;
use serde::{Deserialize, Serialize};
use std::{io::Read, sync::Mutex, time::Duration};
use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;

const REPOSITORY: &str = "https://github.com/kyrie25/wuwa-tappo-mac";
const API: &str = "https://api.github.com/repos/kyrie25/wuwa-tappo-mac/releases?per_page=100";
const MAX_BYTES: u64 = 2 * 1024 * 1024;

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
pub struct UpdaterState(Mutex<Option<Check>>);

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
    Err("The release does not declare its minimum macOS version. Open this fork’s Releases to check compatibility.".into())
}

fn select_release(
    releases: &[Release],
    current: Option<&str>,
    region: Region,
    arch: &str,
    os: &str,
) -> Result<Check, String> {
    let installed = current
        .map(|tag| Version::parse(tag).ok_or("Invalid installed fork release version"))
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
        return Err("Invalid release URL for this fork".into());
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
        return Err("This fork has no update package for this Mac architecture".into());
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
    });
    Ok(result)
}

fn http_error(status: u16) -> String {
    match status {
        403 | 429 => {
            "GitHub denied the update check or its rate limit was reached. Try again later.".into()
        }
        _ => format!("Could not check this fork’s releases (HTTP {status}). Try again later."),
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
        .0
        .try_lock()
        .map_err(|_| "An update check is already in progress. Try again shortly.")?;
    *latest = None;
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
        .0
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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn release(tag: &str) -> Release {
        let base = Version::parse(tag).unwrap().base();
        let assets: Vec<_> = ["CN", "Global"].into_iter().flat_map(|region| ["dmg", "zip"].map(move |ext| (region, ext)))
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
}

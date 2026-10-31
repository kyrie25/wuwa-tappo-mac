use crate::profile::Region;
use std::{fs, io, path::Path};
use tauri::{AppHandle, Manager};

// Copy into a private staging directory before publishing a complete destination.
// Existing new-identity data and the original files are never replaced.
fn copy_missing(source: &Path, target: &Path) -> io::Result<()> {
    if target.try_exists()? || !source.try_exists()? {
        return Ok(());
    }
    let parent = target
        .parent()
        .ok_or_else(|| io::Error::other("Missing migration parent"))?;
    fs::create_dir_all(parent)?;
    let staging = parent.join(format!(".wuwa-identity-{}", std::process::id()));
    fs::create_dir(&staging)?;
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(&staging, fs::Permissions::from_mode(0o700))?;
    fn copy(source: &Path, target: &Path) -> io::Result<()> {
        let metadata = fs::symlink_metadata(source)?;
        if metadata.is_dir() {
            fs::create_dir(target)?;
            fs::set_permissions(target, metadata.permissions())?;
            for entry in fs::read_dir(source)? {
                let entry = entry?;
                copy(&entry.path(), &target.join(entry.file_name()))?;
            }
        } else if metadata.is_file() {
            fs::copy(source, target)?;
        } else {
            return Err(io::Error::other(
                "Unsupported file in app identity migration",
            ));
        }
        Ok(())
    }
    let result = copy(source, &staging.join("data")).and_then(|()| {
        if target.try_exists()? {
            return Ok(());
        }
        fs::rename(staging.join("data"), target)
    });
    let cleanup = fs::remove_dir_all(staging);
    result.and(cleanup)
}

fn migrate_files(library: &Path, identifier: &str, region: Region) -> io::Result<()> {
    let data = library.join("Application Support").join(identifier);
    let marker = data.join(".identity-files-migrated");
    if marker.try_exists()? {
        return Ok(());
    }
    let old = library
        .join("Application Support")
        .join(region.legacy_identifier());
    for name in ["counters.json", "shortcuts.json"] {
        copy_missing(&old.join(name), &data.join(name))?;
    }
    copy_missing(
        &library.join("WebKit").join(region.legacy_identifier()),
        &library.join("WebKit").join(identifier),
    )?;
    fs::create_dir_all(&data)?;
    fs::write(marker, b"1\n")
}

pub fn migrate(app: &AppHandle) -> Result<(), String> {
    let library = app
        .path()
        .home_dir()
        .map_err(|e| e.to_string())?
        .join("Library");
    migrate_files(&library, &app.config().identifier, Region::from_app(app))
        .map_err(|e| format!("Could not migrate saved app data: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    static SEQUENCE: AtomicUsize = AtomicUsize::new(0);

    #[test]
    fn migration_preserves_regions_existing_data_and_deleted_values() {
        let root = std::env::temp_dir().join(format!(
            "wuwa-identity-{}-{}",
            std::process::id(),
            SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        let old_cn = root
            .join("Application Support")
            .join(Region::Cn.legacy_identifier());
        let old_global = root
            .join("Application Support")
            .join(Region::Global.legacy_identifier());
        let new_cn = root.join("Application Support/io.github.kyrie25.wuwatappo.cn.mac");
        let new_global = root.join("Application Support/io.github.kyrie25.wuwatappo.global.mac");
        for dir in [&old_cn, &old_global, &new_cn] {
            fs::create_dir_all(dir).unwrap();
        }
        fs::write(old_cn.join("counters.json"), b"old-cn").unwrap();
        fs::write(old_cn.join("shortcuts.json"), b"cn-shortcuts").unwrap();
        fs::write(old_global.join("counters.json"), b"old-global").unwrap();
        fs::write(new_cn.join("counters.json"), b"new-cn").unwrap();
        let old_webkit = root
            .join("WebKit")
            .join(Region::Cn.legacy_identifier())
            .join("WebsiteData/LocalStorage");
        fs::create_dir_all(&old_webkit).unwrap();
        fs::write(old_webkit.join("synthetic.sqlite"), b"synthetic-settings").unwrap();
        migrate_files(&root, "io.github.kyrie25.wuwatappo.cn.mac", Region::Cn).unwrap();
        assert_eq!(fs::read(new_cn.join("counters.json")).unwrap(), b"new-cn");
        assert_eq!(
            fs::read(new_cn.join("shortcuts.json")).unwrap(),
            b"cn-shortcuts"
        );
        assert_eq!(fs::read(root.join("WebKit/io.github.kyrie25.wuwatappo.cn.mac/WebsiteData/LocalStorage/synthetic.sqlite")).unwrap(), b"synthetic-settings");
        assert!(!new_global.exists());
        fs::remove_file(new_cn.join("shortcuts.json")).unwrap();
        migrate_files(&root, "io.github.kyrie25.wuwatappo.cn.mac", Region::Cn).unwrap();
        assert!(!new_cn.join("shortcuts.json").exists());
        migrate_files(
            &root,
            "io.github.kyrie25.wuwatappo.global.mac",
            Region::Global,
        )
        .unwrap();
        assert_eq!(
            fs::read(new_global.join("counters.json")).unwrap(),
            b"old-global"
        );
        assert_eq!(fs::read(old_cn.join("counters.json")).unwrap(), b"old-cn");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn interrupted_file_migration_is_retryable_without_publishing_partial_data() {
        let root = std::env::temp_dir().join(format!(
            "wuwa-identity-retry-{}-{}",
            std::process::id(),
            SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        let source = root.join("WebKit").join(Region::Cn.legacy_identifier());
        fs::create_dir_all(&source).unwrap();
        std::os::unix::fs::symlink("missing", source.join("unsupported-link")).unwrap();
        let id = "io.github.kyrie25.wuwatappo.cn.mac";
        assert!(migrate_files(&root, id, Region::Cn).is_err());
        assert!(!root.join("WebKit").join(id).exists());
        assert!(!root
            .join("Application Support")
            .join(id)
            .join(".identity-files-migrated")
            .exists());
        assert_eq!(fs::read_dir(root.join("WebKit")).unwrap().count(), 1);
        fs::remove_file(source.join("unsupported-link")).unwrap();
        fs::write(source.join("synthetic-settings"), b"retry").unwrap();
        migrate_files(&root, id, Region::Cn).unwrap();
        assert_eq!(
            fs::read(root.join("WebKit").join(id).join("synthetic-settings")).unwrap(),
            b"retry"
        );
        fs::remove_dir_all(root).unwrap();
    }
}

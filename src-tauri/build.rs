fn main() {
    println!("cargo:rerun-if-env-changed=WUWA_FORK_VERSION");
    if let Ok(tag) = std::env::var("WUWA_FORK_VERSION") {
        let prefix = format!("v{}-mac.", env!("CARGO_PKG_VERSION"));
        let revision = tag
            .strip_prefix(&prefix)
            .expect("Fork tag must match the official resource version");
        assert!(
            !revision.is_empty()
                && revision.bytes().all(|b| b.is_ascii_digit())
                && (revision.len() == 1 || !revision.starts_with('0'))
                && revision.parse::<u64>().is_ok(),
            "Invalid fork revision"
        );
        println!("cargo:rustc-env=WUWA_FORK_VERSION={tag}");
    }
    tauri_build::build()
}

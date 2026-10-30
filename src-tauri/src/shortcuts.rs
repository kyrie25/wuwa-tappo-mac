use serde::{Deserialize, Serialize};
use std::{collections::BTreeSet, fs, path::PathBuf, sync::Mutex};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Binding {
    modifiers: u32,
    key: u32,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Config {
    game_mode: Binding,
    switch_screen: Binding,
    toggle_pet: Binding,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            game_mode: Binding {
                modifiers: 0,
                key: 118,
            },
            switch_screen: Binding {
                modifiers: 0,
                key: 119,
            },
            toggle_pet: Binding {
                modifiers: 0,
                key: 120,
            },
        }
    }
}

impl Config {
    fn entries(&self) -> [(&'static str, Binding); 3] {
        [
            ("gameMode", self.game_mode),
            ("switchScreen", self.switch_screen),
            ("togglePet", self.toggle_pet),
        ]
    }

    fn validate(&self) -> Result<(), String> {
        let mut bindings = BTreeSet::new();
        for (_, binding) in self.entries() {
            binding.shortcut()?;
            if binding.key != 0 && !bindings.insert((binding.modifiers, binding.key)) {
                return Err("duplicate".into());
            }
        }
        Ok(())
    }
}

impl Binding {
    fn shortcut(self) -> Result<Option<Shortcut>, String> {
        if self.modifiers > 15 || (self.key == 0 && self.modifiers != 0) {
            return Err("invalid shortcut".into());
        }
        if self.key == 0 {
            return Ok(None);
        }
        let function = (112..=135).contains(&self.key);
        if !function && self.modifiers & 11 == 0 {
            return Err("invalid shortcut".into());
        }
        let key = match self.key {
            65..=90 => format!("Key{}", char::from_u32(self.key).unwrap()),
            48..=57 => format!("Digit{}", char::from_u32(self.key).unwrap()),
            112..=135 => format!("F{}", self.key - 111),
            value => match value {
                32 => "Space",
                33 => "PageUp",
                34 => "PageDown",
                35 => "End",
                36 => "Home",
                37 => "ArrowLeft",
                38 => "ArrowUp",
                39 => "ArrowRight",
                40 => "ArrowDown",
                45 => "Insert",
                46 => "Delete",
                186 => "Semicolon",
                187 => "Equal",
                188 => "Comma",
                189 => "Minus",
                190 => "Period",
                191 => "Slash",
                192 => "Backquote",
                219 => "BracketLeft",
                220 => "Backslash",
                221 => "BracketRight",
                222 => "Quote",
                _ => return Err("invalid shortcut".into()),
            }
            .into(),
        };
        let mut parts = Vec::new();
        for (mask, name) in [(2, "Ctrl"), (1, "Alt"), (4, "Shift"), (8, "Super")] {
            if self.modifiers & mask != 0 {
                parts.push(name.to_owned());
            }
        }
        parts.push(key);
        parts
            .join("+")
            .parse()
            .map(Some)
            .map_err(|_| "invalid shortcut".into())
    }
}

struct State {
    config: Config,
    capturing: BTreeSet<String>,
}

pub struct Shortcuts {
    path: PathBuf,
    state: Mutex<State>,
}

fn register(app: &AppHandle, config: &Config) -> Result<(), String> {
    let manager = app.global_shortcut();
    manager.unregister_all().map_err(|e| e.to_string())?;
    for (action, binding) in config.entries() {
        if let Some(shortcut) = binding.shortcut()? {
            if let Err(error) = manager.on_shortcut(shortcut, move |app, _, event| {
                if event.state == ShortcutState::Pressed {
                    if let Err(error) = app.emit_to("main", "app-shortcut", action) {
                        eprintln!("Shortcut delivery failed: {error}");
                    }
                }
            }) {
                if let Err(cleanup) = manager.unregister_all() {
                    eprintln!("Shortcut cleanup failed: {cleanup}");
                }
                eprintln!("Shortcut registration failed: {error}");
                return Err("occupied".into());
            }
        }
    }
    Ok(())
}

pub fn setup(app: &AppHandle) -> Result<(), String> {
    let path = app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?
        .join("shortcuts.json");
    let config = match fs::read(&path) {
        Ok(bytes) => {
            let config: Config = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
            config.validate()?;
            config
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Config::default(),
        Err(error) => return Err(error.to_string()),
    };
    // An occupied system shortcut must not prevent the app from launching.
    if let Err(error) = register(app, &config) {
        eprintln!("Could not activate shortcuts: {error}");
    }
    app.manage(Shortcuts {
        path,
        state: Mutex::new(State {
            config,
            capturing: BTreeSet::new(),
        }),
    });
    Ok(())
}

#[tauri::command]
pub fn get_app_shortcuts(state: tauri::State<'_, Shortcuts>) -> Result<Config, String> {
    Ok(state
        .state
        .lock()
        .map_err(|_| "shortcut lock failed")?
        .config
        .clone())
}

#[tauri::command]
pub fn set_app_shortcuts(
    app: AppHandle,
    state: tauri::State<'_, Shortcuts>,
    config: Config,
) -> Result<(), String> {
    config.validate()?;
    let mut current = state.state.lock().map_err(|_| "shortcut lock failed")?;
    if current.capturing.is_empty() {
        if let Err(error) = register(&app, &config) {
            if let Err(restore) = register(&app, &current.config) {
                eprintln!("Shortcut restore failed: {restore}");
            }
            return Err(error);
        }
    }
    let save = (|| {
        fs::create_dir_all(state.path.parent().unwrap())?;
        let temporary = state.path.with_extension("json.tmp");
        fs::write(&temporary, serde_json::to_vec(&config)?)?;
        fs::rename(temporary, &state.path)
    })();
    if let Err(error) = save {
        if current.capturing.is_empty() {
            if let Err(restore) = register(&app, &current.config) {
                eprintln!("Shortcut restore failed: {restore}");
            }
        }
        return Err(format!("Could not save shortcuts: {error}"));
    }
    current.config = config.clone();
    app.emit("app-shortcuts-changed", config)
        .map_err(|e| e.to_string())
}

pub fn capture(app: &AppHandle, owner: &str, active: bool) -> Result<(), String> {
    let state = app.state::<Shortcuts>();
    let mut current = state.state.lock().map_err(|_| "shortcut lock failed")?;
    if active {
        app.global_shortcut()
            .unregister_all()
            .map_err(|e| e.to_string())?;
        current.capturing.insert(owner.to_owned());
    } else if current.capturing.remove(owner) && current.capturing.is_empty() {
        register(app, &current.config)?;
    }
    Ok(())
}

#[tauri::command]
pub fn set_shortcut_capture(
    app: AppHandle,
    window: WebviewWindow,
    active: bool,
) -> Result<(), String> {
    if !matches!(window.label(), "panel" | "main") {
        return Err("Shortcut capture is unavailable in this window".into());
    }
    capture(&app, window.label(), active)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri_plugin_global_shortcut::{Code, Modifiers};

    #[test]
    fn official_defaults_are_distinct_f7_f8_f9() {
        let config = Config::default();
        config.validate().unwrap();
        assert_eq!(config.game_mode.shortcut().unwrap().unwrap().key, Code::F7);
        assert_eq!(
            config.switch_screen.shortcut().unwrap().unwrap().key,
            Code::F8
        );
        assert_eq!(config.toggle_pet.shortcut().unwrap().unwrap().key, Code::F9);
    }

    #[test]
    fn windows_binding_bits_map_to_mac_command_option_control_shift() {
        let key = Binding {
            modifiers: 15,
            key: 65,
        }
        .shortcut()
        .unwrap()
        .unwrap();
        assert_eq!(key.key, Code::KeyA);
        assert!(key
            .mods
            .contains(Modifiers::SUPER | Modifiers::ALT | Modifiers::CONTROL | Modifiers::SHIFT));
        assert_eq!(
            Binding {
                modifiers: 8,
                key: 219
            }
            .shortcut()
            .unwrap()
            .unwrap()
            .key,
            Code::BracketLeft
        );
    }

    #[test]
    fn disabled_bindings_are_allowed_but_duplicates_and_invalid_keys_are_rejected() {
        let disabled = Binding {
            modifiers: 0,
            key: 0,
        };
        let mut config = Config::default();
        config.toggle_pet = config.game_mode;
        assert_eq!(config.validate().unwrap_err(), "duplicate");
        config.toggle_pet = disabled;
        config.game_mode = disabled;
        config.validate().unwrap();
        for binding in [
            Binding {
                modifiers: 16,
                key: 118,
            },
            Binding {
                modifiers: 0,
                key: 65,
            },
            Binding {
                modifiers: 4,
                key: 65,
            },
            Binding {
                modifiers: 8,
                key: 999,
            },
            Binding {
                modifiers: 2,
                key: 0,
            },
        ] {
            assert!(binding.shortcut().is_err());
        }
    }

    #[test]
    fn persisted_config_preserves_the_official_camel_case_contract() {
        let config = Config::default();
        let json = serde_json::to_value(&config).unwrap();
        assert_eq!(json["gameMode"]["key"], 118);
        assert_eq!(json["switchScreen"]["key"], 119);
        assert_eq!(serde_json::from_value::<Config>(json).unwrap(), config);
        assert!(serde_json::from_str::<Config>(r#"{"gameMode":{"key":118}}"#).is_err());
    }
}

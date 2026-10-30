use serde::Serialize;

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SessionMode {
    Memory,
    Keychain,
}

impl Default for SessionMode {
    fn default() -> Self {
        Self::Keychain
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normal_launches_remember_login_and_explicit_test_sessions_remain_distinct() {
        assert_eq!(SessionMode::default(), SessionMode::Keychain);
        assert_eq!(
            serde_json::to_string(&SessionMode::default()).unwrap(),
            "\"keychain\""
        );
        assert_ne!(SessionMode::Memory, SessionMode::default());
    }
}

use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

/// Result returned to the frontend when reading models.yml.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ModelsConfigResult {
    pub path: String,
    pub content: String,
    pub exists: bool,
}

/// Locate the `models.yml` configuration path.
/// Checks `$PI_CODING_AGENT_DIR/models.yml` or defaults to `~/.omp/agent/models.yml`.
pub fn models_config_path(app: &AppHandle) -> Option<PathBuf> {
    if let Ok(dir) = std::env::var("PI_CODING_AGENT_DIR") {
        if !dir.is_empty() {
            return Some(PathBuf::from(dir).join("models.yml"));
        }
    }
    app.path()
        .home_dir()
        .ok()
        .map(|home| home.join(".omp").join("agent").join("models.yml"))
}

/// Default template to populate when models.yml does not exist yet.
pub const DEFAULT_MODELS_TEMPLATE: &str = "\
providers:
  custom-proxy:
    baseUrl: http://localhost:20128/v1
    apiKey: ''
    api: openai-completions
    models:
      - id: auto/best-free
        name: auto/best-free
        contextWindow: 200000
        maxTokens: 8192
";

/// Read the models configuration from disk.
#[tauri::command]
pub fn read_models_config(app: AppHandle) -> Result<ModelsConfigResult, String> {
    let path = models_config_path(&app)
        .ok_or_else(|| "Could not determine models configuration directory".to_string())?;

    let path_str = path.to_string_lossy().into_owned();

    if !path.exists() {
        return Ok(ModelsConfigResult {
            path: path_str,
            content: DEFAULT_MODELS_TEMPLATE.to_string(),
            exists: false,
        });
    }

    let content = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read models configuration at {path_str}: {e}"))?;

    Ok(ModelsConfigResult {
        path: path_str,
        content,
        exists: true,
    })
}

/// Write updated content to `models.yml`, creating a backup `models.yml.bak` if
/// a previous version exists.
#[tauri::command]
pub fn write_models_config(content: String, app: AppHandle) -> Result<(), String> {
    let path = models_config_path(&app)
        .ok_or_else(|| "Could not determine models configuration directory".to_string())?;

    let parent = path
        .parent()
        .ok_or_else(|| "Invalid models config path: missing parent".to_string())?;

    fs::create_dir_all(parent)
        .map_err(|e| format!("Failed to create directory {}: {e}", parent.display()))?;

    // Create backup if previous file exists
    if path.exists() {
        let bak_path = path.with_extension("yml.bak");
        let _ = fs::copy(&path, &bak_path);
    }

    fs::write(&path, content.as_bytes())
        .map_err(|e| format!("Failed to write models config at {}: {e}", path.display()))?;

    Ok(())
}

/// Open the `models.yml` file in the system default text editor.
#[tauri::command]
pub fn open_models_file(app: AppHandle) -> Result<(), String> {
    let path = models_config_path(&app)
        .ok_or_else(|| "Could not determine models configuration directory".to_string())?;

    // If file doesn't exist, create it with default template first
    if !path.exists() {
        if let Some(parent) = path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let _ = fs::write(&path, DEFAULT_MODELS_TEMPLATE.as_bytes());
    }

    let path_str = path.to_string_lossy().into_owned();
    open::that(&path_str).map_err(|e| format!("Failed to open file {path_str}: {e}"))
}

/// Open the directory containing `models.yml` in the system file explorer.
#[tauri::command]
pub fn open_models_folder(app: AppHandle) -> Result<(), String> {
    let path = models_config_path(&app)
        .ok_or_else(|| "Could not determine models configuration directory".to_string())?;

    let folder = path
        .parent()
        .ok_or_else(|| "Invalid models config path: missing parent directory".to_string())?;

    if !folder.exists() {
        let _ = fs::create_dir_all(folder);
    }

    let folder_str = folder.to_string_lossy().into_owned();
    open::that(&folder_str).map_err(|e| format!("Failed to open folder {folder_str}: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_template_has_providers() {
        assert!(DEFAULT_MODELS_TEMPLATE.contains("providers:"));
        assert!(DEFAULT_MODELS_TEMPLATE.contains("custom-proxy:"));
        assert!(DEFAULT_MODELS_TEMPLATE.contains("models:"));
    }

    #[test]
    fn test_custom_env_override() {
        std::env::set_var("PI_CODING_AGENT_DIR", "F:/test_agent_dir");
        // Verify path resolution respects env var
        let path = std::env::var("PI_CODING_AGENT_DIR").map_or_else(
            |_| PathBuf::from("fallback.yml"),
            |dir| PathBuf::from(dir).join("models.yml"),
        );
        assert_eq!(path, PathBuf::from("F:/test_agent_dir/models.yml"));
        std::env::remove_var("PI_CODING_AGENT_DIR");
    }
}

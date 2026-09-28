use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: Option<u64>,
}

/// List files and directories within a given directory path.
/// Results are sorted with directories first (case-insensitive), then files (case-insensitive).
#[tauri::command]
pub fn list_directory(path: String) -> Result<Vec<FileEntry>, String> {
    let p = Path::new(&path);
    if !p.exists() {
        return Err(format!("Path does not exist: {path}"));
    }
    if !p.is_dir() {
        return Err(format!("Path is not a directory: {path}"));
    }

    let read_dir = fs::read_dir(p).map_err(|e| format!("Failed to read directory {path}: {e}"))?;

    let mut entries = Vec::new();

    for item in read_dir {
        let entry = match item {
            Ok(e) => e,
            Err(_) => continue,
        };

        let file_name = entry.file_name().to_string_lossy().into_owned();
        let file_path = entry.path().to_string_lossy().into_owned();
        let metadata = entry.metadata().ok();
        let is_dir = metadata.as_ref().map_or(false, |m| m.is_dir());
        let size = if is_dir { None } else { metadata.as_ref().map(|m| m.len()) };

        entries.push(FileEntry {
            name: file_name,
            path: file_path,
            is_dir,
            size,
        });
    }

    // Sort: directories first (case-insensitive), then files (case-insensitive)
    entries.sort_by(|a, b| {
        match (a.is_dir, b.is_dir) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
        }
    });

    Ok(entries)
}

/// Rename a file or directory.
#[tauri::command]
pub fn rename_file(old_path: String, new_path: String) -> Result<(), String> {
    let old_p = Path::new(&old_path);
    let new_p = Path::new(&new_path);

    if !old_p.exists() {
        return Err(format!("Source path does not exist: {old_path}"));
    }

    if new_p.exists() {
        return Err(format!("Destination already exists: {new_path}"));
    }

    if let Some(parent) = new_p.parent() {
        if !parent.exists() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create parent directories: {e}"))?;
        }
    }

    fs::rename(old_p, new_p).map_err(|e| format!("Failed to rename from {old_path} to {new_path}: {e}"))
}

/// Delete a file or directory recursively.
#[tauri::command]
pub fn delete_file_or_dir(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    if !p.exists() {
        return Err(format!("Path does not exist: {path}"));
    }

    if p.is_dir() {
        fs::remove_dir_all(p).map_err(|e| format!("Failed to delete directory {path}: {e}"))
    } else {
        fs::remove_file(p).map_err(|e| format!("Failed to delete file {path}: {e}"))
    }
}

/// Open a file or folder using the system default application.
#[tauri::command]
pub fn open_path_default(path: String) -> Result<(), String> {
    open::that(&path).map_err(|e| format!("Failed to open {path}: {e}"))
}

/// Reveal a file or folder in the operating system's file manager (File Explorer / Finder).
#[tauri::command]
pub fn reveal_in_explorer(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    if !p.exists() {
        return Err(format!("Path does not exist: {path}"));
    }

    #[cfg(target_os = "windows")]
    {
        let win_path = path.replace('/', "\\");
        std::process::Command::new("explorer")
            .arg(format!("/select,{win_path}"))
            .spawn()
            .map_err(|e| format!("Failed to reveal in File Explorer: {e}"))?;
        Ok(())
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .args(["-R", &path])
            .spawn()
            .map_err(|e| format!("Failed to reveal in Finder: {e}"))?;
        Ok(())
    }

    #[cfg(target_os = "linux")]
    {
        let target = if p.is_dir() { p } else { p.parent().unwrap_or(p) };
        open::that(target).map_err(|e| format!("Failed to reveal in file manager: {e}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::File;

    #[test]
    fn test_list_directory_and_sorting() {
        let temp_dir = std::env::temp_dir().join(format!("pidesk_test_{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        fs::create_dir_all(&temp_dir).unwrap();

        let sub_dir = temp_dir.join("b_dir");
        fs::create_dir_all(&sub_dir).unwrap();

        let file_a = temp_dir.join("a_file.txt");
        File::create(&file_a).unwrap();

        let file_z = temp_dir.join("z_file.txt");
        File::create(&file_z).unwrap();

        let entries = list_directory(temp_dir.to_string_lossy().to_string()).unwrap();
        assert_eq!(entries.len(), 3);
        // Directory must come first
        assert!(entries[0].is_dir);
        assert_eq!(entries[0].name, "b_dir");

        // Files follow, sorted alphabetically
        assert!(!entries[1].is_dir);
        assert_eq!(entries[1].name, "a_file.txt");
        assert!(!entries[2].is_dir);
        assert_eq!(entries[2].name, "z_file.txt");

        let _ = fs::remove_dir_all(&temp_dir);
    }
}

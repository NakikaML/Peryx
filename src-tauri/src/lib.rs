mod commands;
mod index;
mod index_cmd;

use commands::{AppPaths, AppState};
use std::path::PathBuf;
use tauri::Manager;

/// 启动时恢复上次打开的笔记库（目录不存在则忽略）。
fn restore_last_vault(paths: &AppPaths, state: &AppState) {
    let text = match std::fs::read_to_string(&paths.config_file) {
        Ok(t) => t,
        Err(_) => return,
    };
    let cfg: commands::AppConfig = match serde_json::from_str(&text) {
        Ok(c) => c,
        Err(_) => return,
    };
    let Some(last) = cfg.last_vault else { return };
    let p = PathBuf::from(&last);
    if !p.is_dir() {
        return;
    }
    if let Ok(canon) = std::fs::canonicalize(&p) {
        if let Ok(mut guard) = state.vault.lock() {
            *guard = Some(canon);
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .manage(AppState::default())
        .setup(|app| {
            // 配置放在系统应用配置目录，例如
            // Windows: %APPDATA%\com.peryx.notes\config.json
            let dir = app
                .path()
                .app_config_dir()
                .unwrap_or_else(|_| PathBuf::from("."));
            let config_file = dir.join("config.json");
            let paths = AppPaths { config_file };

            {
                let state = app.state::<AppState>();
                restore_last_vault(&paths, &state);
            }

            app.manage(paths);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::open_vault,
            commands::create_vault_dir,
            commands::get_vault,
            commands::close_vault,
            commands::get_recent_vaults,
            commands::forget_vault,
            commands::list_dir,
            commands::get_dir_sort,
            commands::set_dir_sort,
            commands::set_dir_order,
            commands::read_note,
            commands::write_note,
            commands::create_note,
            commands::create_folder,
            commands::delete_entry,
            commands::rename_entry,
            commands::save_attachment,
            commands::reveal_vault,
            // ---- v0.2 索引 / 搜索 / 双链 / 标签 ----
            index_cmd::rebuild_index,
            index_cmd::index_stats,
            index_cmd::search_titles,
            index_cmd::search_content,
            index_cmd::get_backlinks,
            index_cmd::get_all_tags,
            index_cmd::get_notes_with_tag,
            index_cmd::resolve_link,
            index_cmd::list_all_notes,
            index_cmd::get_outlinks,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup(tag: &str) -> (PathBuf, AppPaths) {
        let dir = std::env::temp_dir().join(format!("peryx_restore_{tag}"));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let config_file = dir.join("config.json");
        (dir, AppPaths { config_file })
    }

    #[test]
    fn restores_last_vault_from_config() {
        let (dir, paths) = setup("ok");
        let vault = dir.join("myvault");
        std::fs::create_dir_all(&vault).unwrap();
        let canon = std::fs::canonicalize(&vault).unwrap();

        let cfg = commands::AppConfig {
            last_vault: Some(canon.to_string_lossy().to_string()),
            recent_vaults: vec![canon.to_string_lossy().to_string()],
        };
        std::fs::write(&paths.config_file, serde_json::to_string(&cfg).unwrap()).unwrap();

        let state = AppState::default();
        restore_last_vault(&paths, &state);

        let opened = state.vault.lock().unwrap().clone();
        assert!(opened.is_some(), "应恢复上次打开的笔记库");
        assert_eq!(opened.unwrap(), canon);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn ignores_missing_vault_directory() {
        let (dir, paths) = setup("missing");
        let cfg = commands::AppConfig {
            last_vault: Some(dir.join("not_exist").to_string_lossy().to_string()),
            recent_vaults: vec![],
        };
        std::fs::write(&paths.config_file, serde_json::to_string(&cfg).unwrap()).unwrap();

        let state = AppState::default();
        restore_last_vault(&paths, &state);
        assert!(state.vault.lock().unwrap().is_none(), "目录不存在时不应恢复");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn ignores_absent_or_broken_config() {
        let (dir, paths) = setup("broken");
        let state = AppState::default();
        // 无配置文件
        restore_last_vault(&paths, &state);
        assert!(state.vault.lock().unwrap().is_none());

        // 损坏的 JSON
        std::fs::write(&paths.config_file, "{ not json").unwrap();
        restore_last_vault(&paths, &state);
        assert!(state.vault.lock().unwrap().is_none(), "配置损坏时不应崩溃");

        let _ = std::fs::remove_dir_all(&dir);
    }
}

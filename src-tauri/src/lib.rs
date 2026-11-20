mod commands;
mod index;
mod index_cmd;

use commands::{AppPaths, AppState};
use std::path::PathBuf;
use tauri::Manager;

/// 启动时恢复上次打开的笔记库（目录不存在则忽略）。
///
/// 注意：这里**必须同时构建索引**。
/// 之前只设置了 vault 路径，导致「启动即恢复」的场景下索引为空，
/// 表现为双链、反向链接、搜索、标签、`![[图片]]` 全部失效，
/// 而文件树仍然正常（它直接读磁盘，不经过索引）。
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
    let Ok(canon) = std::fs::canonicalize(&p) else { return };
    {
        if let Ok(mut guard) = state.vault.lock() {
            *guard = Some(canon.clone());
        }
    }
    // 关键：恢复后立即建索引
    commands::rebuild_index_inner(&canon, state);
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
            commands::read_image_data_url,
            // ---- v0.3 资料库 ----
            commands::list_resources,
            commands::read_resource_data_url,
            commands::load_settings,
            commands::save_settings,
            // ---- v0.2 索引 / 搜索 / 双链 / 标签 ----
            index_cmd::rebuild_index,
            index_cmd::index_stats,
            index_cmd::search_titles,
            index_cmd::search_content,
            index_cmd::get_backlinks,
            index_cmd::get_all_tags,
            index_cmd::get_notes_with_tag,
            index_cmd::resolve_link,
            index_cmd::resolve_attachment,
            index_cmd::list_all_notes,
            index_cmd::get_outlinks,
            index_cmd::rename_tag,
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
        std::fs::create_dir_all(vault.join("Picture")).unwrap();
        // 放一篇笔记和一张图片，验证恢复后索引真的建好了
        std::fs::write(
            vault.join("甲.md"),
            "# 甲笔记\n\n#数学\n\n![[符号函数.jpg]]\n",
        )
        .unwrap();
        std::fs::write(vault.join("Picture").join("符号函数.jpg"), b"fake").unwrap();
        let canon = std::fs::canonicalize(&vault).unwrap();

        let cfg = commands::AppConfig {
            last_vault: Some(canon.to_string_lossy().to_string()),
            recent_vaults: vec![canon.to_string_lossy().to_string()],
            settings: None,
        };
        std::fs::write(&paths.config_file, serde_json::to_string(&cfg).unwrap()).unwrap();

        let state = AppState::default();
        restore_last_vault(&paths, &state);

        let opened = state.vault.lock().unwrap().clone();
        assert!(opened.is_some(), "应恢复上次打开的笔记库");
        assert_eq!(opened.unwrap(), canon);

        // 关键回归：恢复笔记库时必须把索引也建好，
        // 否则双链 / 反链 / 搜索 / 标签 / ![[图片]] 全部失效。
        let idx = state.index.read().unwrap();
        assert_eq!(idx.entries.len(), 1, "恢复后笔记索引应已建立");
        assert!(
            idx.attachments.contains_key("符号函数.jpg"),
            "恢复后附件索引应已建立，否则 ![[图片]] 显示不出来"
        );
        assert_eq!(
            idx.resolve_attachment("符号函数.jpg").as_deref(),
            Some("Picture/符号函数.jpg"),
            "应能按文件名解析到子目录里的图片"
        );
        assert_eq!(
            idx.entries.get("甲.md").unwrap().meta.tags,
            vec!["数学".to_string()],
            "恢复后标签也应可用"
        );
        drop(idx);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn ignores_missing_vault_directory() {
        let (dir, paths) = setup("missing");
        let cfg = commands::AppConfig {
            last_vault: Some(dir.join("not_exist").to_string_lossy().to_string()),
            recent_vaults: vec![],
            settings: None,
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

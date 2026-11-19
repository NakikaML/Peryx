//! 索引相关命令：搜索、双链解析、反向链接、标签。
//!
//! 这些命令只读索引（不碰磁盘），所以都很轻；写操作在 `commands.rs` 里
//! 维护索引一致性。

use tauri::State;

use crate::commands::{AppState, CmdResult};
use crate::index::{
    self, ContextHit, IndexStats, LinkRef, NoteHit, NoteMeta, TagCount,
};

fn with_index<T>(
    state: &State<'_, AppState>,
    f: impl FnOnce(&index::NoteIndex) -> T,
) -> CmdResult<T> {
    let guard = state.index.read().map_err(|e| e.to_string())?;
    Ok(f(&guard))
}

/// 重建索引（手动刷新 / 外部改动文件后使用）。
#[tauri::command]
pub fn rebuild_index(state: State<'_, AppState>) -> CmdResult<IndexStats> {
    let root = {
        let guard = state.vault.lock().map_err(|e| e.to_string())?;
        guard.clone().ok_or_else(|| "尚未打开笔记库".to_string())?
    };
    let started = std::time::Instant::now();
    let idx = index::NoteIndex::scan(&root);
    let elapsed = started.elapsed().as_millis() as u64;
    let stats = idx.stats(elapsed);
    if let Ok(mut guard) = state.index.write() {
        *guard = idx;
    }
    Ok(stats)
}

/// 当前索引统计
#[tauri::command]
pub fn index_stats(state: State<'_, AppState>) -> CmdResult<IndexStats> {
    with_index(&state, |i| i.stats(0))
}

/// 按标题 / 路径模糊搜索（命令面板 Ctrl+P）
#[tauri::command]
pub fn search_titles(
    query: String,
    limit: Option<usize>,
    state: State<'_, AppState>,
) -> CmdResult<Vec<NoteHit>> {
    with_index(&state, |i| index::search_titles(i, &query, limit.unwrap_or(30)))
}

/// 全文搜索（Ctrl+Shift+F），返回带上下文的逐行命中
#[tauri::command]
pub fn search_content(
    query: String,
    limit: Option<usize>,
    state: State<'_, AppState>,
) -> CmdResult<Vec<ContextHit>> {
    with_index(&state, |i| index::search_content(i, &query, limit.unwrap_or(100)))
}

/// 反向链接：哪些笔记引用了 `rel_path`
#[tauri::command]
pub fn get_backlinks(rel_path: String, state: State<'_, AppState>) -> CmdResult<Vec<ContextHit>> {
    with_index(&state, |i| index::backlinks(i, &rel_path))
}

/// 所有标签与计数
#[tauri::command]
pub fn get_all_tags(state: State<'_, AppState>) -> CmdResult<Vec<TagCount>> {
    with_index(&state, index::all_tags)
}

/// 带某个标签的所有笔记
#[tauri::command]
pub fn get_notes_with_tag(tag: String, state: State<'_, AppState>) -> CmdResult<Vec<NoteMeta>> {
    with_index(&state, |i| index::notes_with_tag(i, &tag))
}

/// 解析 `[[目标]]` → 实际笔记路径；找不到返回 null（前端显示「待创建」）
#[tauri::command]
pub fn resolve_link(target: String, state: State<'_, AppState>) -> CmdResult<Option<String>> {
    with_index(&state, |i| i.resolve(&target))
}

/// 所有笔记元信息（自动补全、双链候选列表用）
#[tauri::command]
pub fn list_all_notes(state: State<'_, AppState>) -> CmdResult<Vec<NoteMeta>> {
    with_index(&state, |i| i.all_metas())
}

/// 某篇笔记的出链（用于「链接到的笔记」面板）
#[tauri::command]
pub fn get_outlinks(rel_path: String, state: State<'_, AppState>) -> CmdResult<Vec<LinkRef>> {
    with_index(&state, |i| {
        i.get(&rel_path).map(|e| e.meta.links.clone()).unwrap_or_default()
    })
}

/// 重命名标签：把所有笔记里的 `#旧标签` 改成 `#新标签`。
///
/// 返回被修改的文件数。代码块与行内代码里的内容不会被改。
#[tauri::command]
pub fn rename_tag(
    old_tag: String,
    new_tag: String,
    state: State<'_, AppState>,
) -> CmdResult<usize> {
    let root = {
        let guard = state.vault.lock().map_err(|e| e.to_string())?;
        guard.clone().ok_or_else(|| "尚未打开笔记库".to_string())?
    };
    let new_clean = new_tag.trim().trim_start_matches('#').to_string();
    let old_clean = old_tag.trim().trim_start_matches('#').to_string();
    if new_clean.is_empty() {
        return Err("新标签不能为空".into());
    }
    if old_clean.is_empty() {
        return Err("旧标签不能为空".into());
    }
    if old_clean == new_clean {
        return Ok(0);
    }

    // 先取出需要处理的文件列表（避免长时间持锁）
    let targets: Vec<String> = {
        let guard = state.index.read().map_err(|e| e.to_string())?;
        index::notes_with_tag(&guard, &old_clean)
            .into_iter()
            .map(|m| m.path)
            .collect()
    };

    let mut changed = 0usize;
    for rel in targets {
        let full = root.join(rel.replace('/', std::path::MAIN_SEPARATOR_STR));
        let Ok(bytes) = std::fs::read(&full) else { continue };
        let Some(text) = crate::commands::decode_text_public(&bytes) else { continue };
        let updated = index::replace_tag(&text, &old_clean, &new_clean);
        if updated != text {
            if std::fs::write(&full, updated.as_bytes()).is_ok() {
                changed += 1;
            }
        }
    }

    // 内容变了，索引需要重建
    crate::commands::rebuild_index_inner(&root, &state);
    Ok(changed)
}

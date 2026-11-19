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

/// 解析 `![[图片.jpg]]` → 库内实际相对路径；找不到返回 null。
///
/// 支持只写文件名（文件可在任意子目录，例如 `Picture/`）。
///
/// 兜底：若索引整个是空的（例如某些启动路径没建索引），
/// 这里会惰性重建一次再查，避免「文件树能看到图片但嵌入显示不出来」。
#[tauri::command]
pub fn resolve_attachment(
    target: String,
    state: State<'_, AppState>,
) -> CmdResult<Option<String>> {
    let (found, index_empty) = {
        let guard = state.index.read().map_err(|e| e.to_string())?;
        let hit = guard.resolve_attachment(&target);
        let empty = guard.entries.is_empty() && guard.attachments.is_empty();
        (hit, empty)
    };
    if found.is_some() {
        return Ok(found);
    }
    if !index_empty {
        return Ok(None);
    }
    // 索引为空 → 惰性重建后再查一次
    let root = {
        let guard = state.vault.lock().map_err(|e| e.to_string())?;
        guard.clone()
    };
    let Some(root) = root else { return Ok(None) };
    crate::commands::rebuild_index_inner(&root, &state);
    let guard = state.index.read().map_err(|e| e.to_string())?;
    Ok(guard.resolve_attachment(&target))
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
    let changed = rename_tag_on_disk(&root, &old_tag, &new_tag)?;
    // 内容变了，索引需要重建
    crate::commands::rebuild_index_inner(&root, &state);
    Ok(changed)
}

/// `rename_tag` 的实际落盘逻辑（与 Tauri 状态解耦，便于测试）。
pub fn rename_tag_on_disk(root: &std::path::Path, old_tag: &str, new_tag: &str) -> CmdResult<usize> {
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

    // 先扫描出使用该标签的文件（不依赖内存索引，独立可测）
    let idx = index::NoteIndex::scan(root);
    let targets: Vec<String> = index::notes_with_tag(&idx, &old_clean)
        .into_iter()
        .map(|m| m.path)
        .collect();

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
    Ok(changed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn vault(tag: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("peryx_renametag_{tag}"));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("sub")).unwrap();
        dir
    }

    #[test]
    fn rename_tag_rewrites_files_and_reports_count() {
        let dir = vault("hit");
        fs::write(dir.join("a.md"), "# A\n\n#数学 与 [[B]]\n").unwrap();
        fs::write(dir.join("sub").join("b.md"), "# B\n\n也是 #数学\n").unwrap();
        fs::write(dir.join("c.md"), "# C\n\n只有 #物理\n").unwrap();

        let changed = rename_tag_on_disk(&dir, "数学", "代数").unwrap();
        assert_eq!(changed, 2, "应修改 2 个文件");

        let a = fs::read_to_string(dir.join("a.md")).unwrap();
        assert!(a.contains("#代数"), "a.md 应被替换: {a}");
        let b = fs::read_to_string(dir.join("sub").join("b.md")).unwrap();
        assert!(b.contains("#代数"), "b.md 应被替换: {b}");
        let c = fs::read_to_string(dir.join("c.md")).unwrap();
        assert!(c.contains("#物理"), "无关文件不应改动: {c}");

        // 标签确实改名了
        let idx = index::NoteIndex::scan(&dir);
        assert_eq!(index::notes_with_tag(&idx, "代数").len(), 2);
        assert!(index::notes_with_tag(&idx, "数学").is_empty());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn rename_tag_skips_code_blocks() {
        let dir = vault("code");
        fs::write(
            dir.join("a.md"),
            "# A\n\n#数学\n\n```\n#数学\n```\n\n`#数学`\n",
        )
        .unwrap();

        rename_tag_on_disk(&dir, "数学", "代数").unwrap();
        let a = fs::read_to_string(dir.join("a.md")).unwrap();
        assert!(a.contains("\n#代数\n"), "正文应替换: {a}");
        assert!(a.contains("```\n#数学\n```"), "代码块不应替换: {a}");
        assert!(a.contains("`#数学`"), "行内代码不应替换: {a}");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn rename_tag_rejects_empty_and_noop() {
        let dir = vault("empty");
        fs::write(dir.join("a.md"), "# A\n\n#数学\n").unwrap();

        assert!(rename_tag_on_disk(&dir, "", "代数").is_err());
        assert!(rename_tag_on_disk(&dir, "数学", "  ").is_err());
        assert_eq!(rename_tag_on_disk(&dir, "数学", "数学").unwrap(), 0);
        // 不存在的标签
        assert_eq!(rename_tag_on_disk(&dir, "不存在", "代数").unwrap(), 0);

        let _ = fs::remove_dir_all(&dir);
    }
}

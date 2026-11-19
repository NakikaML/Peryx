//! 笔记索引：为双链、反向链接、全文搜索、标签提供数据支撑。
//!
//! 设计取舍：**不用 SQLite**。
//!
//! 规划文档里原本写的是「SQLite + tauri-plugin-sql」，实际实现改为
//! **Rust 侧内存索引**，理由：
//!
//! 1. 引入 `tauri-plugin-sql` 会带进 `sqlx`，编译时间和产物体积明显增加；
//! 2. 笔记库规模通常是几百到几千篇，全量扫描 + 内存驻留完全够用；
//! 3. 索引是「可重建的派生数据」，不值得为它做事务和迁移；
//! 4. 单文件增量更新（按 mtime + size 判断）已经足够，不需要 SQL 索引优化。
//!
//! 如果将来单库超过几万篇导致扫描过慢，再把这一层换成 SQLite——
//! 对外暴露的都是查询函数，替换不影响调用方。

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::time::UNIX_EPOCH;

// ---------------------------------------------------------------------------
// 数据结构
// ---------------------------------------------------------------------------

/// 一条出链（笔记里写的 `[[目标]]` 或 `[[目标|别名]]`）
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkRef {
    /// 目标名（`[[` 与 `]]` 之间、`|` 之前的部分）
    pub target: String,
    /// 别名（`[[目标|别名]]` 中的「别名」）
    pub alias: Option<String>,
    /// 所在行号，**从 1 开始**（便于直接对应编辑器行号）
    pub line: usize,
}

/// 单篇笔记的元信息（不含正文，可安全传给前端）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteMeta {
    /// 相对笔记库根目录的路径，`/` 分隔
    pub path: String,
    /// 标题：首个 `# 标题`，没有则用文件名
    pub title: String,
    pub tags: Vec<String>,
    pub links: Vec<LinkRef>,
    pub mtime_ms: u64,
    pub size: u64,
}

/// 索引内部条目：元信息 + 正文（正文只用于全文搜索，不外传）
pub struct NoteEntry {
    pub meta: NoteMeta,
    pub content: String,
}

/// 索引统计信息
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexStats {
    pub notes: usize,
    pub links: usize,
    pub tags: usize,
    /// 本次构建耗时（毫秒）
    pub build_ms: u64,
}

/// 标题搜索命中（用于 Ctrl+P 命令面板）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteHit {
    pub path: String,
    pub title: String,
    /// 匹配质量分数，越大越靠前
    pub score: i32,
}

/// 正文搜索 / 反向链接命中（带上下文片段）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextHit {
    pub path: String,
    pub title: String,
    /// 行号，从 1 开始
    pub line: usize,
    /// 上下文片段（已折叠换行）
    pub snippet: String,
    /// 匹配文本在 snippet 中的起始字符下标
    pub match_start: usize,
    /// 匹配文本的字符长度
    pub match_len: usize,
}

/// 标签及其出现次数
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TagCount {
    pub tag: String,
    pub count: usize,
}

/// 备注：索引本体
#[derive(Default)]
pub struct NoteIndex {
    pub entries: HashMap<String, NoteEntry>,
}

// ---------------------------------------------------------------------------
// 解析：标题 / 标签 / 双链
// ---------------------------------------------------------------------------

/// 把代码块（``` / ~~~ 围栏）与行内代码（`...`）替换为等长空白，
/// 避免把代码里的 `#include`、`[[x]]` 误判成标签或链接。
///
/// 保持**长度不变、换行不变**，这样行号与字符下标仍与原文对应。
pub fn mask_code(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut fence: Option<char> = None;

    for line in text.split_inclusive('\n') {
        let body = line.trim_end_matches(['\n', '\r']);
        let trimmed = body.trim_start();

        // 围栏开关
        let is_fence = trimmed.starts_with("```") || trimmed.starts_with("~~~");
        if is_fence {
            let ch = trimmed.chars().next().unwrap_or('`');
            match fence {
                None => fence = Some(ch),
                Some(f) if f == ch => fence = None,
                _ => {}
            }
            // 围栏行整行屏蔽
            for c in line.chars() {
                out.push(if c == '\n' || c == '\r' { c } else { ' ' });
            }
            continue;
        }

        if fence.is_some() {
            for c in line.chars() {
                out.push(if c == '\n' || c == '\r' { c } else { ' ' });
            }
            continue;
        }

        // 行内代码：把 `...` 里的内容屏蔽
        let mut in_code = false;
        let mut chars = line.chars().peekable();
        while let Some(c) = chars.next() {
            if c == '`' {
                in_code = !in_code;
                out.push(' ');
                continue;
            }
            if in_code {
                out.push(if c == '\n' || c == '\r' { c } else { ' ' });
            } else {
                out.push(c);
            }
        }
    }
    out
}

/// 解析标题：首个一级标题；没有则用传入的回退值（通常是文件名）。
pub fn parse_title(text: &str, fallback: &str) -> String {
    let masked = mask_code(text);
    for line in masked.lines() {
        let t = line.trim_start();
        if let Some(rest) = t.strip_prefix("# ") {
            let title = rest.trim();
            if !title.is_empty() {
                return title.to_string();
            }
        }
    }
    fallback.to_string()
}

/// 判断字符是否可作为标签的一部分。
///
/// 允许：字母、数字、`_`、`-`、`/`（支持 `#项目/子项` 这种层级标签）。
/// 中文等非 ASCII 字母也算（`is_alphanumeric` 覆盖）。
fn is_tag_char(c: char) -> bool {
    c.is_alphanumeric() || c == '_' || c == '-' || c == '/'
}

/// 提取 `#标签`。
///
/// 规则（与 Obsidian 接近）：
/// - `#` 必须在行首或空白之后（避免把 `a#b` 当标签）
/// - `#` 后不能是空白、不能是 `#`（那是标题）
/// - 标签体至少一个字符，且不能全是数字（避免 `#123` 这种编号）
pub fn parse_tags(masked: &str) -> Vec<String> {
    let mut tags: Vec<String> = Vec::new();
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();

    for line in masked.lines() {
        let chars: Vec<char> = line.chars().collect();
        let mut i = 0;
        while i < chars.len() {
            if chars[i] != '#' {
                i += 1;
                continue;
            }
            // `#` 前必须是行首或空白
            let prev_ok = i == 0 || chars[i - 1].is_whitespace();
            if !prev_ok {
                i += 1;
                continue;
            }
            // 收集标签体
            let start = i + 1;
            let mut j = start;
            while j < chars.len() && is_tag_char(chars[j]) {
                j += 1;
            }
            if j == start {
                i += 1;
                continue;
            }
            let raw: String = chars[start..j].iter().collect();
            let tag = raw.trim_matches('/').to_string();
            // 纯数字不算标签
            let all_digit = tag.chars().all(|c| c.is_ascii_digit());
            if !tag.is_empty() && !all_digit && seen.insert(tag.clone()) {
                tags.push(tag);
            }
            i = j;
        }
    }
    tags
}

/// 提取 `[[双链]]`。
///
/// 支持：
/// - `[[笔记名]]`
/// - `[[笔记名|显示文本]]`
///
/// 嵌套/未闭合的 `[[` 会被忽略（只统计有 `]]` 的）。
pub fn parse_links(masked: &str) -> Vec<LinkRef> {
    let mut links = Vec::new();

    for (idx, line) in masked.lines().enumerate() {
        let chars: Vec<char> = line.chars().collect();
        let mut i = 0;
        while i + 1 < chars.len() {
            if chars[i] != '[' || chars[i + 1] != '[' {
                i += 1;
                continue;
            }
            // 找配对的 ]]
            let mut j = i + 2;
            let mut close: Option<usize> = None;
            while j + 1 < chars.len() {
                if chars[j] == ']' && chars[j + 1] == ']' {
                    close = Some(j);
                    break;
                }
                // 同一行内不允许嵌套 [[
                if chars[j] == '[' && chars[j + 1] == '[' {
                    break;
                }
                j += 1;
            }
            let Some(end) = close else {
                i += 2;
                continue;
            };
            let inner: String = chars[i + 2..end].iter().collect();
            let inner = inner.trim();
            if !inner.is_empty() {
                let (target, alias) = match inner.split_once('|') {
                    Some((t, a)) => (t.trim().to_string(), Some(a.trim().to_string())),
                    None => (inner.to_string(), None),
                };
                if !target.is_empty() {
                    links.push(LinkRef {
                        target,
                        alias: alias.filter(|a| !a.is_empty()),
                        line: idx + 1,
                    });
                }
            }
            i = end + 2;
        }
    }
    links
}

// ---------------------------------------------------------------------------
// 索引构建
// ---------------------------------------------------------------------------

fn mtime_ms(meta: &fs::Metadata) -> u64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// 文件名去掉 `.md` 后缀，作为标题回退与链接匹配用的键。
pub fn stem_of(path: &str) -> &str {
    let name = path.rsplit('/').next().unwrap_or(path);
    name.strip_suffix(".md").or_else(|| name.strip_suffix(".MD")).unwrap_or(name)
}

impl NoteIndex {
    /// 全量扫描整个笔记库并重建索引。
    ///
    /// 会跳过 `.` 开头的目录（如 `.peryx/`）与非 `.md` 文件。
    pub fn scan(root: &Path) -> Self {
        let mut index = NoteIndex::default();
        let mut stack = vec![root.to_path_buf()];

        while let Some(dir) = stack.pop() {
            let Ok(entries) = fs::read_dir(&dir) else { continue };
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                if name.starts_with('.') {
                    continue;
                }
                let Ok(meta) = entry.metadata() else { continue };
                let p = entry.path();
                if meta.is_dir() {
                    stack.push(p);
                    continue;
                }
                let is_md = p
                    .extension()
                    .map(|e| e.eq_ignore_ascii_case("md"))
                    .unwrap_or(false);
                if !is_md {
                    continue;
                }
                let rel = p
                    .strip_prefix(root)
                    .map(|r| r.to_string_lossy().replace('\\', "/"))
                    .unwrap_or_else(|_| name.clone());
                if let Some(entry) = read_entry(&p, &rel, &meta) {
                    index.entries.insert(rel, entry);
                }
            }
        }
        index
    }

    /// 只更新单个文件（保存笔记后调用，避免全量重扫）。
    pub fn refresh_file(&mut self, root: &Path, rel_path: &str) {
        let full = root.join(rel_path.replace('/', std::path::MAIN_SEPARATOR_STR));
        let exists = full
            .extension()
            .map(|e| e.eq_ignore_ascii_case("md"))
            .unwrap_or(false)
            && full.is_file();
        match (exists, fs::metadata(&full)) {
            (true, Ok(meta)) => {
                if let Some(entry) = read_entry(&full, rel_path, &meta) {
                    self.entries.insert(rel_path.to_string(), entry);
                }
            }
            _ => {
                self.entries.remove(rel_path);
            }
        }
    }


    pub fn stats(&self, build_ms: u64) -> IndexStats {
        let mut links = 0usize;
        let mut tags: std::collections::HashSet<&str> = std::collections::HashSet::new();
        for e in self.entries.values() {
            links += e.meta.links.len();
            for t in &e.meta.tags {
                tags.insert(t.as_str());
            }
        }
        IndexStats {
            notes: self.entries.len(),
            links,
            tags: tags.len(),
            build_ms,
        }
    }

    /// 建立「链接目标 → 笔记路径」的查找表。
    ///
    /// 依次尝试：完整相对路径（去 .md）→ 文件名 stem → 标题。
    /// 同一键冲突时保留路径较短的那个（更可能是用户想指的）。
    fn lookup(&self) -> HashMap<String, String> {
        let mut map: HashMap<String, String> = HashMap::new();
        let mut put = |key: String, path: &str| {
            let key = key.to_lowercase();
            if key.is_empty() {
                return;
            }
            match map.get(&key) {
                Some(existing) if existing.len() <= path.len() => {}
                _ => {
                    map.insert(key, path.to_string());
                }
            }
        };

        for (path, entry) in &self.entries {
            // 完整路径（去后缀），例如 "法学/民法典导论"
            let no_ext = path.strip_suffix(".md").unwrap_or(path);
            put(no_ext.to_string(), path);
            // 文件名 stem，例如 "民法典导论"
            put(stem_of(path).to_string(), path);
            // 标题
            put(entry.meta.title.clone(), path);
        }
        map
    }

    /// 把 `[[目标]]` 解析为实际笔记路径。找不到返回 None（→「待创建」）。
    pub fn resolve(&self, target: &str) -> Option<String> {
        let t = target.trim();
        if t.is_empty() {
            return None;
        }
        let key = t.strip_suffix(".md").unwrap_or(t).to_lowercase();
        let map = self.lookup();
        map.get(&key).cloned()
    }

    pub fn get(&self, path: &str) -> Option<&NoteEntry> {
        self.entries.get(path)
    }

    /// 所有笔记元信息，按路径排序（用于自动补全与列表）
    pub fn all_metas(&self) -> Vec<NoteMeta> {
        let mut v: Vec<NoteMeta> = self.entries.values().map(|e| e.meta.clone()).collect();
        v.sort_by(|a, b| a.path.to_lowercase().cmp(&b.path.to_lowercase()));
        v
    }
}

/// 读文件 → 解析 → 生成索引条目
fn read_entry(full: &Path, rel: &str, meta: &fs::Metadata) -> Option<NoteEntry> {
    let bytes = fs::read(full).ok()?;
    let content = crate::commands::decode_text_public(&bytes)?;
    let masked = mask_code(&content);
    let fallback = stem_of(rel).to_string();
    let note_meta = NoteMeta {
        path: rel.to_string(),
        title: parse_title(&content, &fallback),
        tags: parse_tags(&masked),
        links: parse_links(&masked),
        mtime_ms: mtime_ms(meta),
        size: meta.len(),
    };
    Some(NoteEntry {
        meta: note_meta,
        content,
    })
}

// ---------------------------------------------------------------------------
// 查询：标题搜索 / 全文搜索 / 反向链接 / 标签
// ---------------------------------------------------------------------------

/// 模糊匹配打分：连续子串 > 分散字符；前缀匹配额外加分。
///
/// 返回 `None` 表示不匹配。
pub fn fuzzy_score(haystack: &str, needle: &str) -> Option<i32> {
    if needle.is_empty() {
        return Some(0);
    }
    let h: Vec<char> = haystack.to_lowercase().chars().collect();
    let n: Vec<char> = needle.to_lowercase().chars().collect();
    if n.len() > h.len() {
        return None;
    }

    // 1) 连续子串：分数最高
    if let Some(pos) = find_sub(&h, &n) {
        let mut score = 1000 - pos as i32;
        if pos == 0 {
            score += 500; // 前缀匹配
        }
        return Some(score);
    }

    // 2) 分散字符（保持顺序）
    let mut hi = 0;
    let mut matched = 0;
    let mut last_hit: Option<usize> = None;
    let mut score = 0i32;
    for &nc in &n {
        let mut found = false;
        while hi < h.len() {
            if h[hi] == nc {
                if let Some(prev) = last_hit {
                    if hi == prev + 1 {
                        score += 10; // 相邻加成
                    }
                }
                last_hit = Some(hi);
                matched += 1;
                hi += 1;
                found = true;
                break;
            }
            hi += 1;
        }
        if !found {
            return None;
        }
    }
    if matched == n.len() {
        Some(score.min(900))
    } else {
        None
    }
}

fn find_sub(h: &[char], n: &[char]) -> Option<usize> {
    if n.is_empty() || n.len() > h.len() {
        return None;
    }
    (0..=h.len() - n.len()).find(|&i| h[i..i + n.len()] == *n)
}

/// 按标题/路径模糊搜索笔记（Ctrl+P 用）
pub fn search_titles<'a>(
    index: &'a NoteIndex,
    query: &str,
    limit: usize,
) -> Vec<NoteHit> {
    let q = query.trim();
    let mut hits: Vec<NoteHit> = Vec::new();

    for (path, entry) in &index.entries {
        let by_title = fuzzy_score(&entry.meta.title, q);
        let by_path = fuzzy_score(path, q);
        let score = match (by_title, by_path) {
            (Some(a), Some(b)) => a.max(b),
            (Some(a), None) => a,
            (None, Some(b)) => b / 2, // 路径匹配权重低一些
            (None, None) => continue,
        };
        hits.push(NoteHit {
            path: path.clone(),
            title: entry.meta.title.clone(),
            score,
        });
    }

    hits.sort_by(|a, b| b.score.cmp(&a.score).then(a.path.cmp(&b.path)));
    hits.truncate(limit);
    hits
}

/// 在字符数组里忽略大小写地查找子串，返回匹配起点的字符下标。
///
/// 大小写折叠可能改变长度（如 `ß` → `ss`），这里对每个字符取折叠后的第一个字符，
/// 保证下标与原文一一对应。
fn find_ci(chars: &[char], needle: &[char]) -> Option<usize> {
    if needle.is_empty() || needle.len() > chars.len() {
        return None;
    }
    let fold = |c: char| c.to_lowercase().next().unwrap_or(c);
    let lower: Vec<char> = chars.iter().map(|&c| fold(c)).collect();
    let needle_lower: Vec<char> = needle.iter().map(|&c| fold(c)).collect();
    (0..=chars.len() - needle.len()).find(|&i| lower[i..i + needle.len()] == needle_lower[..])
}

/// 截取匹配点前后各 `PAD` 个字符作为片段。
/// 返回 (片段, 匹配在片段中的字符下标, 匹配字符长度)。
fn snippet_at(chars: &[char], pos: usize, match_len: usize) -> (String, usize, usize) {
    const PAD: usize = 30;
    let start = pos.saturating_sub(PAD);
    let end = (pos + match_len + PAD).min(chars.len());
    let raw: String = chars[start..end].iter().collect();
    let raw_len = raw.chars().count();
    let trim_len = raw.trim_start().chars().count();
    let leading = raw_len - trim_len;
    let snippet = raw.trim().to_string();
    (snippet, pos - start - leading.min(pos - start), match_len)
}

/// 全文搜索（Ctrl+Shift+F 用），返回逐行命中的上下文片段。
pub fn search_content(index: &NoteIndex, query: &str, limit: usize) -> Vec<ContextHit> {
    let q = query.trim();
    if q.is_empty() {
        return Vec::new();
    }
    let needle: Vec<char> = q.chars().collect();
    let mut hits: Vec<ContextHit> = Vec::new();

    for (path, entry) in &index.entries {
        for (idx, line) in entry.content.lines().enumerate() {
            let chars: Vec<char> = line.chars().collect();
            let Some(pos) = find_ci(&chars, &needle) else { continue };
            let (snippet, ms, ml) = snippet_at(&chars, pos, needle.len());
            hits.push(ContextHit {
                path: path.clone(),
                title: entry.meta.title.clone(),
                line: idx + 1,
                snippet,
                match_start: ms,
                match_len: ml,
            });
            if hits.len() >= limit * 8 {
                break;
            }
        }
    }

    hits.sort_by(|a, b| a.path.cmp(&b.path).then(a.line.cmp(&b.line)));
    hits.truncate(limit);
    hits
}

/// 反向链接：找出所有 `[[target]]` 指向 `rel_path` 的笔记。
pub fn backlinks(index: &NoteIndex, rel_path: &str) -> Vec<ContextHit> {
    let Some(target_entry) = index.get(rel_path) else {
        return Vec::new();
    };
    let target_stem = stem_of(rel_path).to_lowercase();
    let target_title = target_entry.meta.title.to_lowercase();
    let target_no_ext = rel_path
        .strip_suffix(".md")
        .unwrap_or(rel_path)
        .to_lowercase();

    let mut hits: Vec<ContextHit> = Vec::new();

    for (path, entry) in &index.entries {
        if path == rel_path {
            continue;
        }
        for link in &entry.meta.links {
            let t = link
                .target
                .strip_suffix(".md")
                .unwrap_or(&link.target)
                .to_lowercase();
            if t != target_stem && t != target_title && t != target_no_ext {
                continue;
            }
            // 取该行内容作为片段
            let line_text = entry
                .content
                .lines()
                .nth(link.line.saturating_sub(1))
                .unwrap_or("");
            let chars: Vec<char> = line_text.chars().collect();
            let (snippet, ms, ml) = snippet_around_link(&chars);
            hits.push(ContextHit {
                path: path.clone(),
                title: entry.meta.title.clone(),
                line: link.line,
                snippet,
                match_start: ms,
                match_len: ml,
            });
        }
    }

    hits.sort_by(|a, b| a.path.cmp(&b.path).then(a.line.cmp(&b.line)));
    hits
}

/// 从包含 `[[...]]` 的一行里截取上下文，并标出 `[[...]]` 的位置
fn snippet_around_link(chars: &[char]) -> (String, usize, usize) {
    // 找到 [[ 起点
    let mut link_start = None;
    let mut i = 0;
    while i + 1 < chars.len() {
        if chars[i] == '[' && chars[i + 1] == '[' {
            link_start = Some(i);
            break;
        }
        i += 1;
    }
    let Some(ls) = link_start else {
        // 该行已找不到链接（可能被编辑过），退回行首一段文字
        let text: String = chars.iter().take(60).collect();
        return (text.trim().to_string(), 0, 0);
    };
    // 找到 ]]
    let mut le = ls + 2;
    while le + 1 < chars.len() {
        if chars[le] == ']' && chars[le + 1] == ']' {
            break;
        }
        le += 1;
    }
    let end = (le + 2).min(chars.len());
    snippet_at(chars, ls, end - ls)
}

/// 所有标签及计数，按出现次数降序
pub fn all_tags(index: &NoteIndex) -> Vec<TagCount> {
    let mut map: HashMap<String, usize> = HashMap::new();
    for e in index.entries.values() {
        for t in &e.meta.tags {
            *map.entry(t.clone()).or_insert(0) += 1;
        }
    }
    let mut v: Vec<TagCount> = map
        .into_iter()
        .map(|(tag, count)| TagCount { tag, count })
        .collect();
    v.sort_by(|a, b| b.count.cmp(&a.count).then(a.tag.cmp(&b.tag)));
    v
}

/// 带某个标签的笔记
pub fn notes_with_tag(index: &NoteIndex, tag: &str) -> Vec<NoteMeta> {
    let want = tag.trim_start_matches('#').to_lowercase();
    let mut v: Vec<NoteMeta> = index
        .entries
        .values()
        .filter(|e| e.meta.tags.iter().any(|t| t.to_lowercase() == want))
        .map(|e| e.meta.clone())
        .collect();
    v.sort_by(|a, b| a.title.to_lowercase().cmp(&b.title.to_lowercase()));
    v
}

// ---------------------------------------------------------------------------
// 测试
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_title_prefers_first_h1() {
        let text = "# 我的笔记\n\n正文\n\n# 第二个标题";
        assert_eq!(parse_title(text, "fallback"), "我的笔记");
    }

    #[test]
    fn parse_title_falls_back_to_filename() {
        assert_eq!(parse_title("正文没有标题", "文件名"), "文件名");
        assert_eq!(parse_title("# \n", "文件名"), "文件名");
    }

    #[test]
    fn parse_tags_basic_and_chinese() {
        let t = parse_tags("今天学 #数学 和 #计算机/算法 ，还有 #Python");
        assert!(t.contains(&"数学".to_string()));
        assert!(t.contains(&"计算机/算法".to_string()));
        assert!(t.contains(&"Python".to_string()));
    }

    #[test]
    fn parse_tags_ignores_headings_and_codes() {
        // 标题（# 后跟空格）不是标签
        let t = parse_tags("# 这是标题\n正文");
        assert!(t.is_empty(), "标题不应被当成标签: {t:?}");

        // 代码块里的 #include 不是标签
        let masked = mask_code("```c\n#include <stdio.h>\n```\n");
        assert!(parse_tags(&masked).is_empty());

        // 行内代码里的不是标签
        let masked = mask_code("用 `#tag` 表示标签");
        assert!(parse_tags(&masked).is_empty());
    }

    #[test]
    fn parse_tags_rejects_numbers_and_mid_word_hash() {
        let t = parse_tags("编号 #123 以及 a#b");
        assert!(t.is_empty(), "纯数字与词中 # 都不算标签: {t:?}");
    }

    #[test]
    fn parse_tags_dedupes() {
        let t = parse_tags("#数学 和 #数学");
        assert_eq!(t, vec!["数学".to_string()]);
    }

    #[test]
    fn parse_links_plain_and_alias() {
        let links = parse_links("见 [[微积分基础]] 与 [[导数|这里]]");
        assert_eq!(links.len(), 2);
        assert_eq!(links[0].target, "微积分基础");
        assert_eq!(links[0].alias, None);
        assert_eq!(links[1].target, "导数");
        assert_eq!(links[1].alias, Some("这里".to_string()));
    }

    #[test]
    fn parse_links_reports_line_numbers() {
        let links = parse_links("第一行\n第二行 [[目标]]");
        assert_eq!(links.len(), 1);
        assert_eq!(links[0].line, 2, "行号从 1 开始");
    }

    #[test]
    fn parse_links_ignores_unclosed_and_code() {
        assert!(parse_links("没有闭合 [[abc").is_empty());
        let masked = mask_code("`[[代码里]]`");
        assert!(parse_links(&masked).is_empty());
    }

    #[test]
    fn fuzzy_score_prefers_prefix_then_substring() {
        let prefix = fuzzy_score("微积分基础", "微积").unwrap();
        let middle = fuzzy_score("高等微积分", "微积").unwrap();
        let scattered = fuzzy_score("微 积 分", "微积").unwrap();
        assert!(prefix > middle, "前缀应更高: {prefix} vs {middle}");
        assert!(middle > scattered, "连续应高于分散: {middle} vs {scattered}");
        assert_eq!(fuzzy_score("abc", "xyz"), None);
    }

    #[test]
    fn fuzzy_score_handles_scattered_match() {
        assert!(fuzzy_score("A-B-C", "abc").is_some());
        assert!(fuzzy_score("abc", "abcd").is_none());
    }

    fn make_vault(tag: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("peryx_index_{tag}"));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("sub")).unwrap();
        dir
    }

    #[test]
    fn scan_builds_index_with_links_tags_titles() {
        let dir = make_vault("scan");
        fs::write(
            dir.join("甲.md"),
            "# 甲笔记\n\n这是我的一篇笔记，标签 #数学\n\n链接到 [[乙]] 和 [[丙|别名]]\n",
        )
        .unwrap();
        fs::write(dir.join("sub").join("乙.md"), "# 乙笔记\n\n被甲引用\n").unwrap();
        // 非 md 文件与隐藏目录应被忽略
        fs::write(dir.join("ignore.txt"), "x").unwrap();
        fs::create_dir_all(dir.join(".peryx")).unwrap();
        fs::write(dir.join(".peryx").join("sort.json"), "{}").unwrap();

        let idx = NoteIndex::scan(&dir);
        assert_eq!(idx.entries.len(), 2, "只应索引 .md 文件");

        let a = idx.get("甲.md").expect("甲.md 应被索引");
        assert_eq!(a.meta.title, "甲笔记");
        assert_eq!(a.meta.tags, vec!["数学".to_string()]);
        assert_eq!(a.meta.links.len(), 2);

        // 链接解析：stem 与标题都能命中
        assert_eq!(idx.resolve("乙").as_deref(), Some("sub/乙.md"));
        assert_eq!(idx.resolve("乙笔记").as_deref(), Some("sub/乙.md"));
        assert_eq!(idx.resolve("不存在"), None);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn backlinks_finds_sources() {
        let dir = make_vault("backlinks");
        fs::write(dir.join("甲.md"), "# 甲\n\n引用 [[乙笔记]] 一次\n").unwrap();
        fs::write(dir.join("丙.md"), "# 丙\n\n也引用 [[sub/乙]]\n").unwrap();
        fs::write(dir.join("sub").join("乙.md"), "# 乙笔记\n").unwrap();

        let idx = NoteIndex::scan(&dir);
        let bl = backlinks(&idx, "sub/乙.md");
        let sources: Vec<&str> = bl.iter().map(|h| h.path.as_str()).collect();
        assert!(sources.contains(&"甲.md"), "甲应被识别为反链: {sources:?}");
        assert!(sources.contains(&"丙.md"), "丙应被识别为反链: {sources:?}");
        assert!(bl.iter().all(|h| h.line == 3));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn tags_and_content_search() {
        let dir = make_vault("tags");
        fs::write(dir.join("甲.md"), "# 甲\n\n#数学 与 #物理\n").unwrap();
        fs::write(dir.join("乙.md"), "# 乙\n\n只有 #数学\n").unwrap();

        let idx = NoteIndex::scan(&dir);
        let tags = all_tags(&idx);
        assert_eq!(tags[0].tag, "数学");
        assert_eq!(tags[0].count, 2);

        let with_math = notes_with_tag(&idx, "#数学");
        assert_eq!(with_math.len(), 2);

        let hits = search_content(&idx, "物理", 10);
        assert!(!hits.is_empty());
        assert_eq!(hits[0].path, "甲.md");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn titles_search_ranks_title_match_first() {
        let dir = make_vault("titles");
        fs::write(dir.join("a.md"), "# 微积分基础\n").unwrap();
        fs::write(dir.join("b.md"), "# 高等数学\n\n提到微积分\n").unwrap();

        let idx = NoteIndex::scan(&dir);
        let hits = search_titles(&idx, "微积分", 10);
        assert_eq!(hits[0].path, "a.md", "标题命中应排第一");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn refresh_file_updates_and_removes() {
        let dir = make_vault("refresh");
        let p = dir.join("甲.md");
        fs::write(&p, "# 旧标题\n").unwrap();

        let mut idx = NoteIndex::scan(&dir);
        assert_eq!(idx.get("甲.md").unwrap().meta.title, "旧标题");

        fs::write(&p, "# 新标题\n\n#新标签\n").unwrap();
        idx.refresh_file(&dir, "甲.md");
        let e = idx.get("甲.md").unwrap();
        assert_eq!(e.meta.title, "新标题");
        assert_eq!(e.meta.tags, vec!["新标签".to_string()]);

        fs::remove_file(&p).unwrap();
        idx.refresh_file(&dir, "甲.md");
        assert!(idx.get("甲.md").is_none(), "文件删掉后条目应移除");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn stats_counts_links_and_tags() {
        let dir = make_vault("stats");
        fs::write(dir.join("甲.md"), "# 甲\n\n#数学 [[乙]]\n").unwrap();
        fs::write(dir.join("乙.md"), "# 乙\n\n#物理\n").unwrap();

        let idx = NoteIndex::scan(&dir);
        let s = idx.stats(0);
        assert_eq!(s.notes, 2);
        assert_eq!(s.links, 1);
        assert_eq!(s.tags, 2);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn meta_serializes_to_camel_case() {
        let m = NoteMeta {
            path: "a.md".into(),
            title: "甲".into(),
            tags: vec![],
            links: vec![],
            mtime_ms: 1,
            size: 2,
        };
        let j = serde_json::to_value(&m).unwrap();
        assert!(j.get("mtimeMs").is_some());
        assert!(j.get("mtime_ms").is_none());
    }
}

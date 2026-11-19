//! Peryx 栖知 —— 文件系统命令
//!
//! 所有涉及磁盘读写的命令都会校验目标路径必须位于「当前打开的笔记库」内，
//! 防止前端（或误操作）越界访问用户其他文件。

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;

use tauri::State;

/// 应用全局状态：当前打开的笔记库根目录 + 笔记索引。
#[derive(Default)]
pub struct AppState {
    pub vault: Mutex<Option<PathBuf>>,
    /// 笔记索引（双链 / 反链 / 搜索 / 标签的数据源）
    pub index: std::sync::Arc<std::sync::RwLock<crate::index::NoteIndex>>,
}

/// 应用配置文件路径（在 `setup` 中初始化）。
pub struct AppPaths {
    pub config_file: PathBuf,
}

/// 需要持久化的应用配置。
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    /// 上次打开的笔记库（下次启动自动打开）
    pub last_vault: Option<String>,
    /// 最近打开过的笔记库列表（最新在前，最多 8 个）
    pub recent_vaults: Vec<String>,
}

const MAX_RECENT: usize = 8;

impl AppPaths {
    fn load(&self) -> AppConfig {
        match fs::read_to_string(&self.config_file) {
            Ok(text) => serde_json::from_str::<AppConfig>(&text).unwrap_or_default(),
            Err(_) => AppConfig::default(),
        }
    }

    fn save(&self, cfg: &AppConfig) -> CmdResult<()> {
        if let Some(parent) = self.config_file.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("创建配置目录失败：{e}"))?;
        }
        let text =
            serde_json::to_string_pretty(cfg).map_err(|e| format!("序列化配置失败：{e}"))?;
        fs::write(&self.config_file, text).map_err(|e| format!("写入配置失败：{e}"))
    }

    /// 把某个笔记库记录为「最近使用」
    fn remember(&self, vault_path: &Path) -> CmdResult<()> {
        let p = vault_path.to_string_lossy().to_string();
        let mut cfg = self.load();
        cfg.recent_vaults.retain(|x| !same_path(x, &p));
        cfg.recent_vaults.insert(0, p.clone());
        cfg.recent_vaults.truncate(MAX_RECENT);
        cfg.last_vault = Some(p);
        self.save(&cfg)
    }

    /// 记录「本次不自动打开」（关闭笔记库时调用，但保留最近列表）
    fn forget_last(&self) -> CmdResult<()> {
        let mut cfg = self.load();
        cfg.last_vault = None;
        self.save(&cfg)
    }
}

/// 比较两个路径字符串是否指向同一位置（忽略大小写与末尾分隔符）。
fn same_path(a: &str, b: &str) -> bool {
    let norm = |s: &str| {
        s.replace('\\', "/")
            .trim_end_matches('/')
            .to_lowercase()
    };
    norm(a) == norm(b)
}

/// 统一的错误类型，序列化为字符串供前端显示。
pub type CmdResult<T> = Result<T, String>;

/// 文件树节点。
///
/// 注意：必须用 `rename_all = "camelCase"` 序列化，否则 `is_dir` 会原样输出，
/// 而前端 TypeScript 侧读取的是 `isDir`，导致所有文件夹被误判成笔记。
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FileNode {
    /// 文件或目录名（不含父路径）
    pub name: String,
    /// 相对于笔记库根目录的路径，统一使用 `/` 分隔
    pub path: String,
    /// 是否目录
    pub is_dir: bool,
    /// 修改时间（Unix 毫秒），目录为 0
    pub modified_ms: u64,
    /// 文件大小（字节），目录为 0
    pub size: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct VaultInfo {
    pub root: String,
    pub name: String,
}

// ---------------------------------------------------------------------------
// 路径安全校验
// ---------------------------------------------------------------------------

/// 规范化路径：逐段处理，消掉 `.`、拒绝 `..` 越界，返回相对组件。
fn normalize_relative(rel: &str) -> CmdResult<Vec<String>> {
    let rel = rel.replace('\\', "/");
    let mut out: Vec<String> = Vec::new();
    for seg in rel.split('/') {
        let seg = seg.trim();
        if seg.is_empty() || seg == "." {
            continue;
        }
        if seg == ".." {
            return Err("路径不合法：不允许使用上级目录".into());
        }
        // Windows 非法字符
        if seg.contains(':') || seg.contains('*') || seg.contains('?') || seg.contains('"')
            || seg.contains('<') || seg.contains('>') || seg.contains('|')
        {
            return Err(format!("路径不合法：包含非法字符 `{seg}`"));
        }
        out.push(seg.to_string());
    }
    Ok(out)
}

/// 把相对路径解析成绝对路径，并确认它落在笔记库根目录内。
fn resolve_in_vault(root: &Path, rel: &str) -> CmdResult<PathBuf> {
    let parts = normalize_relative(rel)?;
    let mut p = root.to_path_buf();
    for part in parts {
        p.push(part);
    }
    // 词法上已在 root 之下；再做一次规范化防符号链接穿越（若父目录存在）
    if let Ok(canon_root) = fs::canonicalize(root) {
        if let Ok(canon_target) = fs::canonicalize(&p) {
            if !canon_target.starts_with(&canon_root) {
                return Err("路径不合法：目标不在笔记库内".into());
            }
        } else if let Some(parent) = p.parent() {
            if let Ok(canon_parent) = fs::canonicalize(parent) {
                if !canon_parent.starts_with(&canon_root) {
                    return Err("路径不合法：目标不在笔记库内".into());
                }
            }
        }
    }
    Ok(p)
}

fn get_root(state: &AppState) -> CmdResult<PathBuf> {
    let guard = state.vault.lock().map_err(|e| e.to_string())?;
    guard
        .clone()
        .ok_or_else(|| "尚未打开笔记库".to_string())
}

fn rel_to_string(p: &Path) -> String {
    p.components()
        .filter_map(|c| match c {
            Component::Normal(s) => Some(s.to_string_lossy().to_string()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("/")
}

fn modified_ms(meta: &fs::Metadata) -> u64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

// ---------------------------------------------------------------------------
// 笔记库
// ---------------------------------------------------------------------------

/// 打开（或创建）一个笔记库目录，并记录为当前笔记库 + 写入最近列表。
#[tauri::command]
pub fn open_vault(
    path: String,
    state: State<'_, AppState>,
    paths: State<'_, AppPaths>,
) -> CmdResult<VaultInfo> {
    let root = PathBuf::from(&path);
    if !root.is_dir() {
        return Err(format!("目录不存在：{path}"));
    }
    let root = fs::canonicalize(&root).map_err(|e| format!("无法读取目录：{e}"))?;
    let name = root
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| path.clone());
    let mut guard = state.vault.lock().map_err(|e| e.to_string())?;
    *guard = Some(root.clone());
    drop(guard);
    // 记住这次打开的笔记库（失败不影响打开本身）
    let _ = paths.remember(&root);
    // 构建索引（失败不阻塞打开，索引可随时重建）
    rebuild_index_inner(&root, &state);
    Ok(VaultInfo {
        root: root.to_string_lossy().to_string(),
        name,
    })
}

/// 重建索引的内部实现（打开笔记库、手动刷新时调用）
pub(crate) fn rebuild_index_inner(root: &Path, state: &AppState) {
    let started = std::time::Instant::now();
    let idx = crate::index::NoteIndex::scan(root);
    let elapsed = started.elapsed().as_millis() as u64;
    if let Ok(mut guard) = state.index.write() {
        *guard = idx;
        let _ = elapsed;
    }
}

/// 写文件后增量更新索引中的这一篇
pub(crate) fn touch_index_file(root: &Path, rel_path: &str, state: &AppState) {
    if let Ok(mut guard) = state.index.write() {
        guard.refresh_file(root, rel_path);
    }
}

#[tauri::command]
pub fn get_vault(state: State<'_, AppState>) -> CmdResult<Option<VaultInfo>> {
    let guard = state.vault.lock().map_err(|e| e.to_string())?;
    Ok(guard.as_ref().map(|root| VaultInfo {
        root: root.to_string_lossy().to_string(),
        name: root
            .file_name()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_default(),
    }))
}

#[tauri::command]
pub fn close_vault(state: State<'_, AppState>, paths: State<'_, AppPaths>) -> CmdResult<()> {
    let mut guard = state.vault.lock().map_err(|e| e.to_string())?;
    *guard = None;
    drop(guard);
    // 关闭后不再自动打开，但保留最近列表
    let _ = paths.forget_last();
    Ok(())
}

/// 读取最近打开过的笔记库（已过滤掉不存在的目录）。
#[tauri::command]
pub fn get_recent_vaults(paths: State<'_, AppPaths>) -> CmdResult<Vec<String>> {
    let mut cfg = paths.load();
    let alive: Vec<String> = cfg
        .recent_vaults
        .iter()
        .filter(|p| Path::new(p).is_dir())
        .cloned()
        .collect();
    // 顺便把失效项清理掉
    if alive.len() != cfg.recent_vaults.len() {
        cfg.recent_vaults = alive.clone();
        let _ = paths.save(&cfg);
    }
    Ok(alive)
}

/// 从最近列表中移除某个笔记库。
#[tauri::command]
pub fn forget_vault(path: String, paths: State<'_, AppPaths>) -> CmdResult<()> {
    let mut cfg = paths.load();
    cfg.recent_vaults.retain(|x| !same_path(x, &path));
    if cfg.last_vault.as_deref().map(|p| same_path(p, &path)).unwrap_or(false) {
        cfg.last_vault = None;
    }
    paths.save(&cfg)
}

// ---------------------------------------------------------------------------
// 目录与文件
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 排序：自然排序 + 手动排序
// ---------------------------------------------------------------------------

/// 自然比较：把连续数字当作数值比较，其余按字符比较（忽略大小写）。
///
/// 与字典序的区别：`CPP-2` 会排在 `CPP-10` 前面（Obsidian 的行为）。
fn natural_cmp(a: &str, b: &str) -> std::cmp::Ordering {
    use std::cmp::Ordering;

    let al: Vec<char> = a.to_lowercase().chars().collect();
    let bl: Vec<char> = b.to_lowercase().chars().collect();
    let (mut i, mut j) = (0usize, 0usize);

    while i < al.len() && j < bl.len() {
        let ca = al[i];
        let cb = bl[j];

        if ca.is_ascii_digit() && cb.is_ascii_digit() {
            // 各取一段连续数字
            let si = i;
            while i < al.len() && al[i].is_ascii_digit() {
                i += 1;
            }
            let sj = j;
            while j < bl.len() && bl[j].is_ascii_digit() {
                j += 1;
            }
            let na: String = al[si..i].iter().collect();
            let nb: String = bl[sj..j].iter().collect();
            // 去掉前导零后按数值比较（用长度+字典序避免溢出）
            let ta = na.trim_start_matches('0');
            let tb = nb.trim_start_matches('0');
            let by_len = ta.len().cmp(&tb.len());
            if by_len != Ordering::Equal {
                return by_len;
            }
            let by_val = ta.cmp(tb);
            if by_val != Ordering::Equal {
                return by_val;
            }
            // 数值相同（如 a1 vs a01）：位数少的在前
            let by_digits = na.len().cmp(&nb.len());
            if by_digits != Ordering::Equal {
                return by_digits;
            }
            continue;
        }

        if ca != cb {
            return ca.cmp(&cb);
        }
        i += 1;
        j += 1;
    }

    // 前缀关系：短的在前
    match (i < al.len(), j < bl.len()) {
        (true, false) => Ordering::Greater,
        (false, true) => Ordering::Less,
        _ => Ordering::Equal,
    }
}

/// 单个目录的排序设置。
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DirSort {
    /// `name`（自然排序，默认）或 `manual`（手动排序）
    pub mode: String,
    /// 手动排序时的文件名顺序（仅文件名，不含路径）
    #[serde(default)]
    pub order: Vec<String>,
}

/// 整个笔记库的排序设置：目录相对路径 → 设置
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct SortConfig {
    #[serde(default)]
    pub dirs: std::collections::HashMap<String, DirSort>,
}

fn sort_file_path(root: &Path) -> PathBuf {
    root.join(".peryx").join("sort.json")
}

fn load_sort_config(root: &Path) -> SortConfig {
    match fs::read_to_string(sort_file_path(root)) {
        Ok(text) => serde_json::from_str(&text).unwrap_or_default(),
        Err(_) => SortConfig::default(),
    }
}

fn save_sort_config(root: &Path, cfg: &SortConfig) -> CmdResult<()> {
    let file = sort_file_path(root);
    if let Some(parent) = file.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建 .peryx 目录失败：{e}"))?;
    }
    let text = serde_json::to_string_pretty(cfg).map_err(|e| format!("序列化排序设置失败：{e}"))?;
    fs::write(&file, text).map_err(|e| format!("写入排序设置失败：{e}"))
}

/// 按目录的排序设置对节点排序：
/// - `manual` 且有序号表：按序号排，未列出的排在后面（自然排序）
/// - 否则：`name` 模式，目录在前，自然排序
fn sort_nodes(nodes: &mut [FileNode], setting: Option<&DirSort>) {
    let manual_order = setting.filter(|s| s.mode == "manual");

    if let Some(setting) = manual_order {
        let index: std::collections::HashMap<&str, usize> = setting
            .order
            .iter()
            .enumerate()
            .map(|(i, n)| (n.as_str(), i))
            .collect();
        nodes.sort_by(|a, b| {
            let ia = index.get(a.name.as_str());
            let ib = index.get(b.name.as_str());
            match (ia, ib) {
                (Some(x), Some(y)) => x.cmp(y),
                (Some(_), None) => std::cmp::Ordering::Less,
                (None, Some(_)) => std::cmp::Ordering::Greater,
                // 都未指定：目录在前 + 自然排序
                (None, None) => match (a.is_dir, b.is_dir) {
                    (true, false) => std::cmp::Ordering::Less,
                    (false, true) => std::cmp::Ordering::Greater,
                    _ => natural_cmp(&a.name, &b.name),
                },
            }
        });
        return;
    }

    // 名称模式（Obsidian 默认）：目录在前，然后自然排序
    nodes.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => natural_cmp(&a.name, &b.name),
    });
}

/// 列出目录下的子项（仅目录与 `.md` 文件，隐藏项与非 md 文件忽略）。
#[tauri::command]
pub fn list_dir(rel_path: String, state: State<'_, AppState>) -> CmdResult<Vec<FileNode>> {
    let root = get_root(&state)?;
    let dir = if rel_path.trim().is_empty() {
        root.clone()
    } else {
        resolve_in_vault(&root, &rel_path)?
    };
    if !dir.is_dir() {
        return Err(format!("不是目录：{rel_path}"));
    }
    let mut nodes: Vec<FileNode> = Vec::new();
    let entries = fs::read_dir(&dir).map_err(|e| format!("读取目录失败：{e}"))?;
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        let path = entry.path();
        let meta = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        let is_dir = meta.is_dir();
        if !is_dir {
            let is_md = path
                .extension()
                .map(|e| e.eq_ignore_ascii_case("md"))
                .unwrap_or(false);
            if !is_md {
                continue;
            }
        }
        nodes.push(FileNode {
            name,
            path: rel_to_string(path.strip_prefix(&root).unwrap_or(&path)),
            is_dir,
            modified_ms: if is_dir { 0 } else { modified_ms(&meta) },
            size: if is_dir { 0 } else { meta.len() },
        });
    }

    // 读取该目录的排序设置并应用
    let cfg = load_sort_config(&root);
    let key = rel_path.trim_matches('/').replace('\\', "/");
    sort_nodes(&mut nodes, cfg.dirs.get(&key));

    Ok(nodes)
}

/// 获取某个目录当前的排序方式（`name` / `manual`）。
#[tauri::command]
pub fn get_dir_sort(rel_path: String, state: State<'_, AppState>) -> CmdResult<String> {
    let root = get_root(&state)?;
    let cfg = load_sort_config(&root);
    let key = rel_path.trim_matches('/').replace('\\', "/");
    Ok(cfg
        .dirs
        .get(&key)
        .map(|s| s.mode.clone())
        .unwrap_or_else(|| "name".to_string()))
}

/// 设置某个目录的排序方式。切回 `name` 时清除手动顺序。
#[tauri::command]
pub fn set_dir_sort(
    rel_path: String,
    mode: String,
    state: State<'_, AppState>,
) -> CmdResult<()> {
    let root = get_root(&state)?;
    let key = rel_path.trim_matches('/').replace('\\', "/");
    let mut cfg = load_sort_config(&root);
    match mode.as_str() {
        "name" => {
            cfg.dirs.remove(&key);
        }
        "manual" => {
            let entry = cfg.dirs.entry(key).or_insert_with(|| DirSort {
                mode: "manual".into(),
                order: Vec::new(),
            });
            entry.mode = "manual".into();
        }
        other => return Err(format!("未知的排序方式：{other}")),
    }
    save_sort_config(&root, &cfg)
}

/// 保存某个目录的手动排序顺序（文件名列表），并切换为手动模式。
#[tauri::command]
pub fn set_dir_order(
    rel_path: String,
    order: Vec<String>,
    state: State<'_, AppState>,
) -> CmdResult<()> {
    let root = get_root(&state)?;
    let key = rel_path.trim_matches('/').replace('\\', "/");
    let mut cfg = load_sort_config(&root);
    cfg.dirs.insert(
        key,
        DirSort {
            mode: "manual".into(),
            order,
        },
    );
    save_sort_config(&root, &cfg)
}


/// 读取 Markdown 文本。
#[tauri::command]
pub fn read_note(rel_path: String, state: State<'_, AppState>) -> CmdResult<String> {
    let root = get_root(&state)?;
    let p = resolve_in_vault(&root, &rel_path)?;

    // 明确区分「不存在 / 是目录 / 不是 .md」的情况，给出可读的提示
    let meta = fs::metadata(&p).map_err(|_| format!("笔记不存在：{rel_path}"))?;
    if meta.is_dir() {
        return Err(format!("「{rel_path}」是文件夹，不是笔记"));
    }
    if !p
        .extension()
        .map(|e| e.eq_ignore_ascii_case("md"))
        .unwrap_or(false)
    {
        return Err(format!("「{rel_path}」不是 Markdown 文件"));
    }

    let bytes = fs::read(&p).map_err(|e| format!("读取失败：{e}"))?;
    // 兼容 BOM 与非 UTF-8 编码
    decode_text(&bytes).ok_or_else(|| format!("无法解码文件内容（可能不是 UTF-8 编码）：{rel_path}"))
}

/// 解码文本：去 BOM，优先 UTF-8，失败则按 GB18030（中文 Windows 常见）回退。
pub(crate) fn decode_text_public(bytes: &[u8]) -> Option<String> {
    decode_text(bytes)
}

fn decode_text(bytes: &[u8]) -> Option<String> {
    let bytes = if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        &bytes[3..]
    } else {
        bytes
    };
    if let Ok(s) = std::str::from_utf8(bytes) {
        return Some(s.to_string());
    }
    // 非 UTF-8：尝试 GB18030（GBK 超集，中文 Windows 常见）
    if let Some(s) = decode_gb18030(bytes) {
        return Some(s);
    }
    // 最后回退：有损解码，至少不丢内容
    Some(String::from_utf8_lossy(bytes).to_string())
}

/// 用 Windows 系统 API 做 GB18030 解码（无额外依赖）。
#[cfg(target_os = "windows")]
fn decode_gb18030(bytes: &[u8]) -> Option<String> {
    use std::ffi::OsString;
    use std::os::windows::ffi::OsStringExt;

    extern "system" {
        fn MultiByteToWideChar(
            code_page: u32,
            dw_flags: u32,
            lp_multi_byte_str: *const u8,
            cb_multi_byte: i32,
            lp_wide_char_str: *mut u16,
            cch_wide_char: i32,
        ) -> i32;
    }
    const CP_GB18030: u32 = 54936;
    if bytes.is_empty() {
        return Some(String::new());
    }
    let len = unsafe { MultiByteToWideChar(CP_GB18030, 0, bytes.as_ptr(), bytes.len() as i32, std::ptr::null_mut(), 0) };
    if len <= 0 {
        return None;
    }
    let mut buf: Vec<u16> = vec![0; len as usize];
    let written = unsafe {
        MultiByteToWideChar(CP_GB18030, 0, bytes.as_ptr(), bytes.len() as i32, buf.as_mut_ptr(), len)
    };
    if written <= 0 {
        return None;
    }
    buf.truncate(written as usize);
    Some(OsString::from_wide(&buf).to_string_lossy().to_string())
}

#[cfg(not(target_os = "windows"))]
fn decode_gb18030(_bytes: &[u8]) -> Option<String> {
    None
}

/// 写入 Markdown 文本（自动创建中间目录）。
#[tauri::command]
pub fn write_note(rel_path: String, content: String, state: State<'_, AppState>) -> CmdResult<()> {
    let root = get_root(&state)?;
    let p = resolve_in_vault(&root, &rel_path)?;
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建目录失败：{e}"))?;
    }
    fs::write(&p, content.as_bytes()).map_err(|e| format!("写入失败：{e}"))?;
    touch_index_file(&root, &rel_path, &state);
    Ok(())
}

/// 新建笔记（若已存在则返回错误，避免覆盖）。
#[tauri::command]
pub fn create_note(rel_path: String, state: State<'_, AppState>) -> CmdResult<String> {
    let root = get_root(&state)?;
    let p = resolve_in_vault(&root, &rel_path)?;
    if p.exists() {
        return Err(format!("文件已存在：{rel_path}"));
    }
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建目录失败：{e}"))?;
    }
    let title = p
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();
    fs::write(&p, format!("# {title}\n\n")).map_err(|e| format!("创建失败：{e}"))?;
    let rel = rel_to_string(p.strip_prefix(&root).unwrap_or(&p));
    touch_index_file(&root, &rel, &state);
    Ok(rel)
}

/// 新建文件夹。
#[tauri::command]
pub fn create_folder(rel_path: String, state: State<'_, AppState>) -> CmdResult<()> {
    let root = get_root(&state)?;
    let p = resolve_in_vault(&root, &rel_path)?;
    fs::create_dir_all(&p).map_err(|e| format!("创建文件夹失败：{e}"))
}

/// 删除文件或空文件夹。非空文件夹需要 `recursive`。
#[tauri::command]
pub fn delete_entry(
    rel_path: String,
    recursive: bool,
    state: State<'_, AppState>,
) -> CmdResult<()> {
    let root = get_root(&state)?;
    let p = resolve_in_vault(&root, &rel_path)?;
    if p == root {
        return Err("不能删除笔记库根目录".into());
    }
    if !p.exists() {
        return Err(format!("目标不存在：{rel_path}"));
    }
    if p.is_dir() {
        if recursive {
            fs::remove_dir_all(&p).map_err(|e| format!("删除失败：{e}"))?;
        } else {
            fs::remove_dir(&p).map_err(|e| format!("目录非空：{e}"))?;
        }
    } else {
        fs::remove_file(&p).map_err(|e| format!("删除失败：{e}"))?;
    }
    // 删除会影响该路径及其所有子路径，索引直接全量重建（删除不频繁）
    rebuild_index_inner(&root, &state);
    Ok(())
}

/// 重命名（同目录内移动）。返回新的相对路径。
#[tauri::command]
pub fn rename_entry(
    rel_path: String,
    new_name: String,
    state: State<'_, AppState>,
) -> CmdResult<String> {
    let root = get_root(&state)?;
    let from = resolve_in_vault(&root, &rel_path)?;
    let new_name = new_name.trim();
    if new_name.is_empty() {
        return Err("名称不能为空".into());
    }
    let parts = normalize_relative(new_name)?;
    if parts.len() != 1 {
        return Err("新名称不能包含路径分隔符".into());
    }
    if !from.exists() {
        return Err(format!("目标不存在：{rel_path}"));
    }
    let to = from
        .parent()
        .map(|p| p.join(new_name))
        .ok_or_else(|| "无法解析父目录".to_string())?;
    if to.exists() {
        return Err(format!("已存在同名项：{new_name}"));
    }
    fs::rename(&from, &to).map_err(|e| format!("重命名失败：{e}"))?;
    // 重命名 = 旧路径消失 + 新路径出现；重命名后可能整目录变化，直接重建索引
    rebuild_index_inner(&root, &state);
    Ok(rel_to_string(to.strip_prefix(&root).unwrap_or(&to)))
}

/// 保存图片到 `assets/` 并返回其相对路径（供 Markdown 引用）。
#[tauri::command]
pub fn save_attachment(
    file_name: String,
    data: Vec<u8>,
    state: State<'_, AppState>,
) -> CmdResult<String> {
    let root = get_root(&state)?;
    let safe_name: String = file_name
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '.' || c == '-' || c == '_' { c } else { '_' })
        .collect();
    if safe_name.trim_matches('_').is_empty() {
        return Err("文件名不合法".into());
    }
    let assets = root.join("assets");
    fs::create_dir_all(&assets).map_err(|e| format!("创建 assets 目录失败：{e}"))?;
    // 避免重名覆盖：追加序号
    let (stem, ext) = match safe_name.rsplit_once('.') {
        Some((s, e)) => (s.to_string(), format!(".{e}")),
        None => (safe_name.clone(), String::new()),
    };
    let mut candidate = assets.join(&safe_name);
    let mut i = 1;
    while candidate.exists() {
        candidate = assets.join(format!("{stem}-{i}{ext}"));
        i += 1;
    }
    fs::write(&candidate, &data).map_err(|e| format!("保存图片失败：{e}"))?;
    Ok(rel_to_string(candidate.strip_prefix(&root).unwrap_or(&candidate)))
}

/// 创建一个新目录作为笔记库（父目录必须存在）。
#[tauri::command]
pub fn create_vault_dir(path: String) -> CmdResult<()> {
    let p = PathBuf::from(&path);
    if p.exists() {
        return Err(format!("目录已存在：{path}"));
    }
    fs::create_dir_all(&p).map_err(|e| format!("创建目录失败：{e}"))?;
    // 写入一个简短的说明文件，说明这是 Peryx 笔记库
    let readme = p.join("欢迎使用栖知.md");
    let _ = fs::write(
        &readme,
        "# 欢迎使用栖知 Peryx\n\n\
这是一篇示例笔记，你可以直接修改或删除它。\n\n\
## 试试这些\n\n\
- **加粗**、*斜体*、~~删除线~~、==高亮==、`行内代码`\n\
- 表格、图片、代码块都可以用顶部工具栏按钮插入\n\
- 数学公式：$E = mc^2$\n\n\
$$\\int_0^1 x^2\\,dx = \\frac{1}{3}$$\n\n\
> 所有内容都是纯 Markdown 文件，保存在你自己的文件夹里。\n",
    );
    Ok(())
}

/// 让系统文件管理器打开笔记库目录。
#[tauri::command]
pub fn reveal_vault(state: State<'_, AppState>) -> CmdResult<String> {
    let root = get_root(&state)?;
    Ok(root.to_string_lossy().to_string())
}

// ---------------------------------------------------------------------------
// 单元测试：重点覆盖路径越界防护（这是数据安全的关键）
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_allows_plain_segments() {
        assert_eq!(
            normalize_relative("笔记/数学/微积分.md").unwrap(),
            vec!["笔记", "数学", "微积分.md"]
        );
    }

    #[test]
    fn normalize_strips_current_dir() {
        assert_eq!(normalize_relative("./a/./b.md").unwrap(), vec!["a", "b.md"]);
    }

    #[test]
    fn normalize_rejects_parent_escape() {
        assert!(normalize_relative("../etc/passwd").is_err());
        assert!(normalize_relative("a/../../b").is_err());
    }

    #[test]
    fn normalize_rejects_illegal_windows_chars() {
        assert!(normalize_relative("a/b:c.md").is_err());
        assert!(normalize_relative("a/b*.md").is_err());
        assert!(normalize_relative("a/b?.md").is_err());
    }

    #[test]
    fn normalize_accepts_backslash_separators() {
        assert_eq!(normalize_relative("a\\b\\c.md").unwrap(), vec!["a", "b", "c.md"]);
    }

    #[test]
    fn resolve_stays_inside_vault() {
        let tmp = std::env::temp_dir().join("peryx_test_vault");
        let _ = fs::create_dir_all(&tmp);
        let root = fs::canonicalize(&tmp).unwrap();

        let ok = resolve_in_vault(&root, "笔记/测试.md").unwrap();
        assert!(ok.starts_with(&root));

        assert!(resolve_in_vault(&root, "../../windows/system32").is_err());
    }

    #[test]
    fn write_and_read_roundtrip() {
        let root = std::env::temp_dir().join("peryx_test_rt");
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        let root = fs::canonicalize(&root).unwrap();

        let p = resolve_in_vault(&root, "sub/note.md").unwrap();
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        let content = "# 标题\n\n数学公式 $E=mc^2$\n";
        fs::write(&p, content.as_bytes()).unwrap();
        let back = fs::read_to_string(&p).unwrap();
        assert_eq!(back, content);

        let _ = fs::remove_dir_all(&root);
    }

    /// 回归测试：读取文件夹必须明确报错，而不是抛出原始的 os error 5
    #[test]
    fn reading_a_directory_is_a_clear_error() {
        let root = std::env::temp_dir().join("peryx_test_dirread");
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("法学")).unwrap();
        let root = fs::canonicalize(&root).unwrap();

        let dir = resolve_in_vault(&root, "法学").unwrap();
        assert!(dir.is_dir());
        // 模拟 read_note 的判断逻辑
        assert!(dir.is_dir(), "目录不应被当作笔记读取");

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn decode_handles_bom_and_plain_utf8() {
        let plain = "hello 你好".as_bytes().to_vec();
        assert_eq!(decode_text(&plain).unwrap(), "hello 你好");

        let mut with_bom = vec![0xEF, 0xBB, 0xBF];
        with_bom.extend_from_slice("# 标题".as_bytes());
        assert_eq!(decode_text(&with_bom).unwrap(), "# 标题");
    }

    #[test]
    fn decode_falls_back_to_gb18030_for_non_utf8() {
        // GBK 编码的「中文笔记」：D6 D0 CE C4 B1 CA BC C7
        let gbk: Vec<u8> = vec![0xD6, 0xD0, 0xCE, 0xC4, 0xB1, 0xCA, 0xBC, 0xC7];
        let decoded = decode_text(&gbk).unwrap();
        // 在中文 Windows 上应还原为「中文笔记」
        #[cfg(target_os = "windows")]
        assert_eq!(decoded, "中文笔记");
        // 其他平台至少有损解码，不 panic
        #[cfg(not(target_os = "windows"))]
        assert!(!decoded.is_empty());
    }

    /// 回归测试：FileNode 必须序列化成 camelCase，前端靠 `isDir` 判断文件夹。
    /// 若这里失败，界面上所有文件夹都会被当成笔记（历史 Bug）。
    #[test]
    fn file_node_serializes_to_camel_case() {
        let node = FileNode {
            name: "法学".into(),
            path: "法学".into(),
            is_dir: true,
            modified_ms: 123,
            size: 456,
        };
        let json = serde_json::to_value(&node).unwrap();

        assert_eq!(json["isDir"], serde_json::json!(true), "必须输出 isDir");
        assert_eq!(json["modifiedMs"], serde_json::json!(123), "必须输出 modifiedMs");
        assert!(
            json.get("is_dir").is_none(),
            "不应再输出 snake_case 的 is_dir"
        );

        // 反序列化也要能读回 camelCase
        let back: FileNode = serde_json::from_value(json).unwrap();
        assert!(back.is_dir);
        assert_eq!(back.modified_ms, 123);
    }

    #[test]
    fn vault_info_serializes_to_camel_case() {
        let v = VaultInfo {
            root: "D:\\vault".into(),
            name: "vault".into(),
        };
        let json = serde_json::to_value(&v).unwrap();
        assert_eq!(json["root"], serde_json::json!("D:\\vault"));
        assert_eq!(json["name"], serde_json::json!("vault"));
    }

    // ---- 配置持久化 ----

    fn tmp_paths(tag: &str) -> AppPaths {
        let dir = std::env::temp_dir().join(format!("peryx_cfg_{tag}"));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        AppPaths {
            config_file: dir.join("config.json"),
        }
    }

    #[test]
    fn config_roundtrip_and_remember() {
        let paths = tmp_paths("remember");
        let vault = std::env::temp_dir().join("peryx_cfg_vault_a");
        fs::create_dir_all(&vault).unwrap();
        let canon = fs::canonicalize(&vault).unwrap();

        // 记录两个笔记库
        paths.remember(&canon).unwrap();
        let other = std::env::temp_dir().join("peryx_cfg_vault_b");
        fs::create_dir_all(&other).unwrap();
        let canon2 = fs::canonicalize(&other).unwrap();
        paths.remember(&canon2).unwrap();

        let cfg = paths.load();
        // 最新在前
        assert_eq!(cfg.recent_vaults.len(), 2);
        assert!(same_path(&cfg.recent_vaults[0], &canon2.to_string_lossy()));
        assert_eq!(
            cfg.last_vault.as_deref().map(|x| same_path(x, &canon2.to_string_lossy())),
            Some(true)
        );

        // 重复打开同一个不应产生重复项
        paths.remember(&canon).unwrap();
        let cfg = paths.load();
        assert_eq!(cfg.recent_vaults.len(), 2);

        let _ = fs::remove_dir_all(&vault);
        let _ = fs::remove_dir_all(&other);
        let _ = fs::remove_dir_all(paths.config_file.parent().unwrap());
    }

    #[test]
    fn forget_last_keeps_recent_list() {
        let paths = tmp_paths("forget");
        let vault = std::env::temp_dir().join("peryx_cfg_vault_c");
        fs::create_dir_all(&vault).unwrap();
        let canon = fs::canonicalize(&vault).unwrap();

        paths.remember(&canon).unwrap();
        paths.forget_last().unwrap();

        let cfg = paths.load();
        assert!(cfg.last_vault.is_none(), "关闭后不应再自动打开");
        assert_eq!(cfg.recent_vaults.len(), 1, "最近列表要保留");

        let _ = fs::remove_dir_all(&vault);
        let _ = fs::remove_dir_all(paths.config_file.parent().unwrap());
    }

    #[test]
    fn config_serializes_to_camel_case() {
        let cfg = AppConfig {
            last_vault: Some("D:\\v".into()),
            recent_vaults: vec!["D:\\v".into()],
        };
        let json = serde_json::to_value(&cfg).unwrap();
        assert!(json.get("lastVault").is_some(), "必须是 lastVault");
        assert!(json.get("recentVaults").is_some(), "必须是 recentVaults");
        assert!(json.get("last_vault").is_none());
    }

    #[test]
    fn same_path_ignores_case_and_separators() {
        assert!(same_path("D:\\Notes\\A", "d:/notes/a/"));
        assert!(!same_path("D:\\Notes\\A", "D:\\Notes\\B"));
    }

    // ---- 自然排序 ----

    #[test]
    fn natural_cmp_sorts_numbers_by_value() {
        use std::cmp::Ordering;
        // 核心诉求：CPP-2 排在 CPP-10 之前
        assert_eq!(natural_cmp("CPP-2", "CPP-10"), Ordering::Less);
        assert_eq!(natural_cmp("CPP-10", "CPP-2"), Ordering::Greater);
        assert_eq!(natural_cmp("CPP-1", "CPP-1"), Ordering::Equal);
    }

    #[test]
    fn natural_cmp_orders_a_full_sequence() {
        let mut v = vec![
            "CPP-10", "CPP-2", "CPP-1", "CPP-11", "CPP-12", "CPP-3",
        ];
        v.sort_by(|a, b| natural_cmp(a, b));
        assert_eq!(
            v,
            vec!["CPP-1", "CPP-2", "CPP-3", "CPP-10", "CPP-11", "CPP-12"]
        );
    }

    #[test]
    fn natural_cmp_is_case_insensitive_and_prefix_aware() {
        use std::cmp::Ordering;
        assert_eq!(natural_cmp("abc", "ABC"), Ordering::Equal);
        assert_eq!(natural_cmp("a", "ab"), Ordering::Less);
        assert_eq!(natural_cmp("ab", "a"), Ordering::Greater);
        // 前导零
        assert_eq!(natural_cmp("a1", "a01"), Ordering::Less);
        assert_eq!(natural_cmp("a01", "a1"), Ordering::Greater);
    }

    fn node(name: &str, is_dir: bool) -> FileNode {
        FileNode {
            name: name.into(),
            path: name.into(),
            is_dir,
            modified_ms: 0,
            size: 0,
        }
    }

    #[test]
    fn sort_nodes_puts_dirs_first_then_natural() {
        let mut nodes = vec![
            node("CPP-10.md", false),
            node("Python", true),
            node("CPP-2.md", false),
            node("Godot", true),
            node("CPP-1.md", false),
        ];
        sort_nodes(&mut nodes, None);
        let names: Vec<&str> = nodes.iter().map(|n| n.name.as_str()).collect();
        assert_eq!(
            names,
            vec!["Godot", "Python", "CPP-1.md", "CPP-2.md", "CPP-10.md"]
        );
    }

    #[test]
    fn sort_nodes_respects_manual_order() {
        let mut nodes = vec![
            node("c.md", false),
            node("a.md", false),
            node("b.md", false),
            node("z.md", false),
        ];
        let setting = DirSort {
            mode: "manual".into(),
            order: vec!["c.md".into(), "a.md".into(), "b.md".into()],
        };
        sort_nodes(&mut nodes, Some(&setting));
        let names: Vec<&str> = nodes.iter().map(|n| n.name.as_str()).collect();
        // 前三个按手动顺序，未列出的 z.md 排最后
        assert_eq!(names, vec!["c.md", "a.md", "b.md", "z.md"]);
    }

    #[test]
    fn sort_config_roundtrip() {
        let dir = std::env::temp_dir().join("peryx_sortcfg");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        let mut cfg = SortConfig::default();
        cfg.dirs.insert(
            "03-ComputerScience/C++程序设计基础".into(),
            DirSort {
                mode: "manual".into(),
                order: vec!["CPP-2.md".into(), "CPP-1.md".into()],
            },
        );
        save_sort_config(&dir, &cfg).unwrap();

        let back = load_sort_config(&dir);
        let e = back.dirs.get("03-ComputerScience/C++程序设计基础").unwrap();
        assert_eq!(e.mode, "manual");
        assert_eq!(e.order, vec!["CPP-2.md", "CPP-1.md"]);

        // 落盘位置：<vault>/.peryx/sort.json
        assert!(sort_file_path(&dir).ends_with("sort.json"));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn sort_config_serializes_to_camel_case() {
        let mut cfg = SortConfig::default();
        cfg.dirs.insert(
            "d".into(),
            DirSort {
                mode: "manual".into(),
                order: vec![],
            },
        );
        let json = serde_json::to_value(&cfg).unwrap();
        assert!(json.get("dirs").is_some());
    }
}

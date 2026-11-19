/** 全局类型定义 */

/** 笔记库信息 */
export interface VaultInfo {
  root: string;
  name: string;
}

/** 文件树节点（与 Rust `FileNode` 对应） */
export interface FileNode {
  name: string;
  /** 相对笔记库根目录，使用 `/` 分隔 */
  path: string;
  isDir: boolean;
  /** 修改时间（Unix 毫秒）；目录为 0 */
  modifiedMs: number;
  size: number;
}

/** 编辑器视图模式 */
export type EditorMode = "live" | "source";

/** 当前打开的笔记 */
export interface OpenNote {
  path: string;
  title: string;
  content: string;
  /** 相对磁盘内容是否有未保存改动 */
  dirty: boolean;
}

/** 目录树展开状态：key 为目录相对路径 */
export type ExpandedMap = Record<string, true>;

/** 目录树的子节点缓存 */
export type ChildrenMap = Record<string, FileNode[]>;

// ---------------------------------------------------------------------------
// v0.2 知识连接
// ---------------------------------------------------------------------------

/** 一条出链（笔记里写的 `[[目标]]` / `[[目标|别名]]`） */
export interface LinkRef {
  target: string;
  alias: string | null;
  /** 行号，从 1 开始 */
  line: number;
}

/** 笔记元信息（不含正文） */
export interface NoteMeta {
  path: string;
  title: string;
  tags: string[];
  links: LinkRef[];
  mtimeMs: number;
  size: number;
}

/** 索引统计 */
export interface IndexStats {
  notes: number;
  links: number;
  tags: number;
  buildMs: number;
}

/** 标题搜索命中（命令面板用） */
export interface NoteHit {
  path: string;
  title: string;
  score: number;
}

/** 正文搜索 / 反向链接命中（带上下文） */
export interface ContextHit {
  path: string;
  title: string;
  /** 行号，从 1 开始 */
  line: number;
  snippet: string;
  /** 匹配在 snippet 中的起始字符下标 */
  matchStart: number;
  matchLen: number;
}

/** 标签及计数 */
export interface TagCount {
  tag: string;
  count: number;
}

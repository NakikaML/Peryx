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

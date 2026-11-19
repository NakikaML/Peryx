/** Tauri 后端命令的 TypeScript 封装。 */

import { invoke } from "@tauri-apps/api/core";
import type { FileNode, VaultInfo } from "./types";

/** 是否运行在 Tauri 环境（浏览器里调试时为 false） */
export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export const api = {
  /** 打开（或创建）笔记库 */
  openVault: (path: string) => invoke<VaultInfo>("open_vault", { path }),

  /** 获取当前笔记库 */
  getVault: () => invoke<VaultInfo | null>("get_vault"),

  /** 关闭当前笔记库 */
  closeVault: () => invoke<void>("close_vault"),

  /** 最近打开过的笔记库列表（已过滤失效目录） */
  getRecentVaults: () => invoke<string[]>("get_recent_vaults"),

  /** 从最近列表中移除某个笔记库 */
  forgetVault: (path: string) => invoke<void>("forget_vault", { path }),

  /** 列出目录内容（仅目录与 .md 文件） */
  listDir: (relPath: string) => invoke<FileNode[]>("list_dir", { relPath }),

  /** 读取某个目录当前的排序方式：`name` / `manual` */
  getDirSort: (relPath: string) => invoke<string>("get_dir_sort", { relPath }),

  /** 设置某个目录的排序方式 */
  setDirSort: (relPath: string, mode: "name" | "manual") =>
    invoke<void>("set_dir_sort", { relPath, mode }),

  /** 保存某个目录的手动顺序（文件名数组），并切换为手动模式 */
  setDirOrder: (relPath: string, order: string[]) =>
    invoke<void>("set_dir_order", { relPath, order }),

  /** 读取笔记内容 */
  readNote: (relPath: string) => invoke<string>("read_note", { relPath }),

  /** 写入笔记内容 */
  writeNote: (relPath: string, content: string) =>
    invoke<void>("write_note", { relPath, content }),

  /** 新建笔记，返回实际相对路径 */
  createNote: (relPath: string) => invoke<string>("create_note", { relPath }),

  /** 新建文件夹 */
  createFolder: (relPath: string) => invoke<void>("create_folder", { relPath }),

  /** 删除文件或文件夹 */
  deleteEntry: (relPath: string, recursive = false) =>
    invoke<void>("delete_entry", { relPath, recursive }),

  /** 重命名，返回新路径 */
  renameEntry: (relPath: string, newName: string) =>
    invoke<string>("rename_entry", { relPath, newName }),

  /** 保存图片附件到 assets/，返回相对路径 */
  saveAttachment: (fileName: string, data: number[]) =>
    invoke<string>("save_attachment", { fileName, data }),

  /** 获取笔记库绝对路径 */
  revealVault: () => invoke<string>("reveal_vault"),
};

/** 把后端错误整理成可读文本 */
export function errText(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  return String(e);
}

/**
 * 双链目标存在性缓存。
 *
 * 编辑器每渲染一行都要判断 `[[目标]]` 是否存在。如果每个链接都调一次
 * `resolve_link`，一篇笔记里几十个链接就是几十次 IPC，明显卡顿。
 *
 * 这里在前端维护一份「可解析名字集合」，随索引刷新一次性同步；
 * 编辑器只做内存查找。
 *
 * 与后端 `NoteIndex::lookup` 保持同一套匹配规则：
 * 完整相对路径（去 .md）→ 文件名 stem → 标题，全部小写比较。
 */

import { api } from "@/lib/api";
import type { NoteMeta } from "@/lib/types";

/** 小写名 → 笔记相对路径 */
let nameToPath = new Map<string, string>();
/** 所有笔记元信息（供补全、标签视图等使用） */
let allNotes: NoteMeta[] = [];
/** 版本号：缓存变化时递增，供编辑器判断是否需要重算装饰 */
let version = 0;

/** 取路径最后一段并去掉 .md */
function stemOf(path: string): string {
  const name = path.split("/").pop() ?? path;
  return name.replace(/\.md$/i, "");
}

function addKey(map: Map<string, string>, key: string, path: string) {
  const k = key.trim().toLowerCase();
  if (!k) return;
  const existing = map.get(k);
  // 冲突时保留路径更短的（与后端一致）
  if (existing && existing.length <= path.length) return;
  map.set(k, path);
}

/** 用后端返回的笔记列表重建缓存 */
export function setLinkIndex(notes: NoteMeta[]) {
  allNotes = notes;
  const map = new Map<string, string>();
  for (const n of notes) {
    addKey(map, n.path.replace(/\.md$/i, ""), n.path);
    addKey(map, stemOf(n.path), n.path);
    addKey(map, n.title, n.path);
  }
  nameToPath = map;
  version++;
}

/** 从后端拉取并重建缓存（打开笔记库 / 保存笔记后调用） */
export async function refreshLinkIndex(): Promise<void> {
  try {
    const notes = await api.listAllNotes();
    setLinkIndex(notes);
  } catch {
    /* 索引不可用时不阻塞编辑 */
  }
}

/** 清空缓存（关闭笔记库时） */
export function clearLinkIndex() {
  nameToPath = new Map();
  allNotes = [];
  version++;
}

/** `[[目标]]` 是否存在对应笔记 */
export function linkTargetExists(target: string): boolean {
  return resolveLinkTarget(target) !== null;
}

/** `[[目标]]` → 笔记相对路径；不存在返回 null */
export function resolveLinkTarget(target: string): string | null {
  const key = target.trim().replace(/\.md$/i, "").toLowerCase();
  if (!key) return null;
  return nameToPath.get(key) ?? null;
}

/** 当前缓存版本（变化时应重算编辑器装饰） */
export function linkIndexVersion(): number {
  return version;
}

/** 全部笔记（副本） */
export function allNoteMetas(): NoteMeta[] {
  return allNotes;
}

/**
 * `![[图片]]` 内嵌图片的 data URL 缓存。
 *
 * 编辑器每次重算装饰都会重新创建 widget，如果每次都在 widget 里发 IPC 读文件，
 * 滚动或编辑时会不断重复读盘。这里按相对路径缓存结果：
 * - 命中缓存直接返回（同步，widget 可同步渲染）
 * - 未命中时发起一次异步加载，完成后通过订阅者回调通知编辑器重绘
 */

import { api } from "@/lib/api";

const cache = new Map<string, string>();
/** 加载中的路径，避免同一张图并发请求多次 */
const pending = new Set<string>();
/** 失败过的路径，避免反复重试（用户改名后会自然失效） */
const failed = new Set<string>();
/** 加载完成后通知编辑器重算 */
const listeners = new Set<() => void>();

/** 订阅「图片加载完成」事件，返回取消订阅函数 */
export function onImageLoaded(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify() {
  for (const fn of listeners) fn();
}

/** 同步取已缓存的图片；没有则返回 null 并按需触发加载 */
export function getCachedImage(relPath: string): string | null {
  const hit = cache.get(relPath);
  if (hit) return hit;
  if (failed.has(relPath) || pending.has(relPath)) return null;

  pending.add(relPath);
  void loadImage(relPath)
    .then((url) => {
      cache.set(relPath, url);
      pending.delete(relPath);
      notify();
    })
    .catch(() => {
      pending.delete(relPath);
      failed.add(relPath);
      // 失败也通知一次，让编辑器把占位换成「加载失败」
      notify();
    });
  return null;
}

/**
 * 读取图片。
 *
 * 关键：`![[图片.jpg]]` 通常只写文件名，文件可能在库内任意子目录
 * （Obsidian 的典型用法：图片统一放 `Picture/`）。
 * 所以先让后端按文件名在**全库范围内**解析出真实路径，
 * 解析不到再退回按原样读取（用户写的就是完整相对路径）。
 */
async function loadImage(relPath: string): Promise<string> {
  let resolved = relPath;
  try {
    const found = await api.resolveAttachment(relPath);
    if (found) resolved = found;
  } catch {
    /* 解析失败就按原样读 */
  }
  return api.readImageDataUrl(resolved);
}

/** 是否已知加载失败 */
export function imageFailed(relPath: string): boolean {
  return failed.has(relPath);
}

/** 清空缓存（切换笔记库时调用） */
export function clearImageCache() {
  cache.clear();
  pending.clear();
  failed.clear();
}

/**
 * 把 `![[目标]]` 里的目标规整为缓存键。
 *
 * 不再拼接当前笔记目录：`![[图片.jpg]]` 的文件可能在库内任意子目录
 * （如 `Picture/`），真正的查找交给后端 `resolve_attachment`。
 * 这里只做轻量清理，保证同一目标得到同一个缓存键。
 */
export function resolveImagePath(target: string, _currentNotePath: string): string {
  const t = target.trim().replace(/\\/g, "/");
  return t.replace(/^\.\//, "");
}

/** 若图片放在 assets/ 下，作为兜底路径 */
export function assetsPath(target: string): string {
  return `assets/${target.trim()}`;
}

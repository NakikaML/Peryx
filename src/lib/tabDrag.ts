/**
 * Tab 拖拽的共享状态。
 *
 * HTML5 拖放在 `dragover` 阶段拿不到 dataTransfer 的内容（浏览器限制），
 * 所以用一个模块级变量记住「正在拖哪个标签」，供拖放热区判断。
 */

/** 面板标识：主面板 / 分屏 */
export type PaneId = "main" | "side";

let dragging: { path: string; pane: PaneId } | null = null;

export function setDraggingTab(path: string | null, pane: PaneId | null) {
  dragging = path && pane ? { path, pane } : null;
}

export function getDraggingTab(): { path: string; pane: PaneId } | null {
  return dragging;
}

/** 分屏方向 */
export type SplitSide = "left" | "right" | "top" | "bottom";

export const SPLIT_SIDES: SplitSide[] = ["left", "right", "top", "bottom"];

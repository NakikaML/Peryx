/**
 * Tab 拖拽的共享状态。
 *
 * HTML5 拖放在 `dragover` 阶段拿不到 dataTransfer 的内容（浏览器限制），
 * 所以用一个模块级变量记住「正在拖哪个标签」，供拖放热区判断。
 */

let dragging: string | null = null;

export function setDraggingTab(path: string | null) {
  dragging = path;
}

export function getDraggingTab(): string | null {
  return dragging;
}

/** 分屏方向 */
export type SplitSide = "left" | "right" | "top" | "bottom";

export const SPLIT_SIDES: SplitSide[] = ["left", "right", "top", "bottom"];

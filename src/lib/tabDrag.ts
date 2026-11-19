/**
 * 标签页拖拽（指针事件实现，不用 HTML5 Drag and Drop）。
 *
 * 为什么不用原生拖放：
 * - `dragover` 阶段读不到 `dataTransfer`，只能靠模块变量兜底
 * - 各浏览器对 `dragstart`/`dragend` 的触发时机不一致，
 *   React 重渲染时还可能直接把拖动打断
 * - 合成事件测得过、真实拖动却不生效，很难排查
 *
 * 改成 mousedown → mousemove（超过阈值）→ mouseup 自己判定落点，
 * 行为完全可控，也能用真实鼠标事件测试。
 */

/** 面板标识：主面板 / 分屏 */
export type PaneId = "main" | "side";

/** 分屏方向 */
export type SplitSide = "left" | "right" | "top" | "bottom";

export interface TabDragState {
  path: string;
  /** 从哪个面板拖出来的 */
  pane: PaneId;
}

let state: TabDragState | null = null;
const listeners = new Set<(s: TabDragState | null) => void>();

export function subscribeTabDrag(fn: (s: TabDragState | null) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit() {
  for (const fn of listeners) fn(state);
}

export function getTabDrag(): TabDragState | null {
  return state;
}

export function startTabDrag(path: string, pane: PaneId) {
  state = { path, pane };
  emit();
}

export function endTabDrag() {
  state = null;
  emit();
}

/**
 * 根据指针位置算出落在哪个投放区。
 *
 * 把编辑区按比例切成四块边缘区域，取「离哪条边最近」；
 * 落在中间（离四边都超过 25%）视为不投放。
 */
export function zoneAt(rect: DOMRect, x: number, y: number): SplitSide | null {
  if (rect.width === 0 || rect.height === 0) return null;
  if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) return null;

  const relX = (x - rect.left) / rect.width;
  // 左侧 30% → 左边分屏；右侧 30% → 右边分屏；中间不投放
  if (relX < 0.3) return "left";
  if (relX > 0.7) return "right";
  return null;
}

export const SPLIT_SIDES: SplitSide[] = ["left", "right"];

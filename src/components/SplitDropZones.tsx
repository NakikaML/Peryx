/**
 * Tab 拖拽分屏的投放热区（纯展示）。
 *
 * 落点判定在 App 里按指针坐标算（见 lib/tabDrag.ts 的 zoneAt），
 * 这里只负责画四个方向的提示区，并把当前命中的那个高亮。
 */

import type { SplitSide } from "@/lib/tabDrag";

const SIDES: { side: SplitSide; label: string; hint: string }[] = [
  { side: "left", label: "⬒", hint: "在左侧分屏" },
  { side: "right", label: "⬓", hint: "在右侧分屏" },
  { side: "top", label: "⬒", hint: "在上方分屏" },
  { side: "bottom", label: "⬓", hint: "在下方分屏" },
];

export function SplitDropZones({ hover }: { hover: SplitSide | null }) {
  return (
    <div className="drop-zones" data-testid="drop-zones">
      {SIDES.map(({ side, label, hint }) => (
        <div
          key={side}
          data-drop-side={side}
          className={`drop-zone zone-${side} ${hover === side ? "hot" : ""}`}
          title={hint}
        >
          <span className="drop-zone-icon">{label}</span>
          <span className="drop-zone-hint">{hint}</span>
        </div>
      ))}
    </div>
  );
}

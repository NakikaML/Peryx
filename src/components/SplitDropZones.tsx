/**
 * Tab 拖拽分屏的投放热区（纯展示）。
 *
 * 落点判定在 App 里按指针坐标算（见 lib/tabDrag.ts 的 zoneAt），
 * 这里只负责画左右两个投放区，并把当前命中的那个高亮。
 *
 * 上下分屏暂时不做（v0.3），所以只有左右两块。
 */

import type { SplitSide } from "@/lib/tabDrag";

const SIDES: { side: SplitSide; label: string; hint: string }[] = [
  { side: "left", label: "⬒", hint: "在左侧分屏" },
  { side: "right", label: "⬓", hint: "在右侧分屏" },
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

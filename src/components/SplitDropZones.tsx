/**
 * Tab 拖拽分屏的投放热区。
 *
 * 拖动标签页时在编辑区浮出四个方向的投放区（左/右/上/下），
 * 放到哪个区域就在哪个方向开分屏，与 Obsidian 的行为一致。
 */

import { useState } from "react";
import { useStore } from "@/stores/app";
import { getDraggingTab, type SplitSide } from "@/lib/tabDrag";

const SIDES: { side: SplitSide; label: string; hint: string }[] = [
  { side: "left", label: "⬒", hint: "在左侧分屏" },
  { side: "right", label: "⬓", hint: "在右侧分屏" },
  { side: "top", label: "⬒", hint: "在上方分屏" },
  { side: "bottom", label: "⬓", hint: "在下方分屏" },
];

export function SplitDropZones() {
  const openInSplit = useStore((s) => s.openInSplit);
  const [hover, setHover] = useState<SplitSide | null>(null);

  const handleDrop = (side: SplitSide) => (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // 优先取 dataTransfer，取不到就看模块里的拖拽状态
    const path =
      e.dataTransfer?.getData("application/x-peryx-tab") ||
      e.dataTransfer?.getData("text/plain") ||
      getDraggingTab();
    setHover(null);
    if (path) openInSplit(path, side);
  };

  return (
    <div className="drop-zones" data-testid="drop-zones">
      {SIDES.map(({ side, label, hint }) => (
        <div
          key={side}
          data-drop-side={side}
          className={`drop-zone zone-${side} ${hover === side ? "hot" : ""}`}
          title={hint}
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
            setHover(side);
          }}
          onDragLeave={() => setHover((cur) => (cur === side ? null : cur))}
          onDrop={handleDrop(side)}
        >
          <span className="drop-zone-icon">{label}</span>
          <span className="drop-zone-hint">{hint}</span>
        </div>
      ))}
    </div>
  );
}

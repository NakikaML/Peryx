/**
 * Tab 拖拽分屏的投放热区。
 *
 * 拖动标签页时在编辑区浮出四个方向的投放区（左/右/上/下），
 * 放到哪个区域就在哪个方向开分屏，与 Obsidian 的行为一致。
 *
 * 从主面板拖来的标签是**移动**（主面板不再保留），
 * 从分屏自己拖来的只改变方向。
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

export function SplitDropZones({ onDropped }: { onDropped?: () => void }) {
  const openInSplit = useStore((s) => s.openInSplit);
  const moveTabToSplit = useStore((s) => s.moveTabToSplit);
  const [hover, setHover] = useState<SplitSide | null>(null);

  const handleDrop = (side: SplitSide) => (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setHover(null);

    // 优先取 dataTransfer，取不到就看模块里的拖拽状态
    const fromDt =
      e.dataTransfer?.getData("application/x-peryx-tab") ||
      e.dataTransfer?.getData("text/plain") ||
      "";
    const dragging = getDraggingTab();
    const path = fromDt || dragging?.path || "";
    // 投放后立刻收起热区：drop 被 stopPropagation 后不会冒泡到 window，
    // 只依赖 dragend 的话热区会一直挂着
    onDropped?.();
    if (!path) return;

    if (dragging?.pane === "side") {
      // 分屏里的标签换个方向：留在分屏
      openInSplit(path, side);
    } else {
      // 主面板的标签 → 移动到分屏
      moveTabToSplit(path, side);
    }
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

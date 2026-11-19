/**
 * 标签页栏：主面板与分屏共用。
 *
 * 交互：
 * - 点击切换、中键或 × 关闭
 * - 右键：关闭其它 / 关闭全部（仅主面板）
 * - 按住拖动 → 拖到编辑区四边可以开分屏或移动过去
 *   （用指针事件实现，见 lib/tabDrag.ts 里的说明）
 */

import { useEffect, useRef, useState } from "react";
import type { NoteTab } from "@/lib/types";
import { startTabDrag, type PaneId } from "@/lib/tabDrag";

interface Props {
  /** 哪个面板（决定拖拽来源） */
  pane: PaneId;
  tabs: NoteTab[];
  activePath: string | null;
  onActivate: (path: string) => void;
  onClose: (path: string) => void;
  /** 右键菜单里的额外动作（主面板才有） */
  onCloseOthers?: (path: string) => void;
  /** 分屏面板用：显示关闭分屏按钮 */
  onClosePane?: () => void;
}

/** 超过这个位移才认为是拖动，避免影响单击 */
const DRAG_THRESHOLD = 4;

export function TabStrip({
  pane,
  tabs,
  activePath,
  onActivate,
  onClose,
  onCloseOthers,
  onClosePane,
}: Props) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const [menu, setMenu] = useState<{ path: string; x: number; y: number } | null>(null);

  // 切换笔记时把当前标签滚进可视区
  useEffect(() => {
    if (!activePath || !listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(
      `[data-tab-path="${CSS.escape(activePath)}"]`,
    );
    el?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activePath]);

  // 点击别处关掉右键菜单
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [menu]);

  /** 开始跟踪一次可能的拖动 */
  const beginDragTracking = (e: React.MouseEvent, path: string) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest(".tab-close")) return;

    const startX = e.clientX;
    const startY = e.clientY;
    let started = false;

    const onMove = (ev: MouseEvent) => {
      if (started) return;
      if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < DRAG_THRESHOLD) return;
      started = true;
      startTabDrag(path, pane);
      cleanup();
    };
    const cleanup = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    const onUp = () => cleanup();

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  if (tabs.length === 0 && !onClosePane) return null;

  return (
    <div className={`tabbar tabbar-${pane}`}>
      <div className="tabbar-list" ref={listRef}>
        {tabs.map((t) => {
          const active = t.path === activePath;
          return (
            <div
              key={t.path}
              data-tab-path={t.path}
              data-tab-pane={pane}
              className={`tab ${active ? "active" : ""}`}
              title={t.path}
              onMouseDown={(e) => {
                if (e.button === 1) {
                  e.preventDefault();
                  onClose(t.path);
                  return;
                }
                beginDragTracking(e, t.path);
              }}
              onClick={() => {
                if (!active) onActivate(t.path);
              }}
              onContextMenu={(e) => {
                if (!onCloseOthers) return;
                e.preventDefault();
                setMenu({ path: t.path, x: e.clientX, y: e.clientY });
              }}
            >
              <span className="tab-title">{t.title}</span>
              <button
                className="tab-close"
                title="关闭标签页"
                onClick={(e) => {
                  e.stopPropagation();
                  onClose(t.path);
                }}
              >
                ×
              </button>
            </div>
          );
        })}
      </div>

      {onClosePane && (
        <button className="tabbar-pane-close" title="关闭这个分屏" onClick={onClosePane}>
          ✕
        </button>
      )}

      {menu && onCloseOthers && (
        <div
          className="tab-menu"
          style={{ left: menu.x, top: menu.y }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            className="tab-menu-item"
            onClick={() => {
              onCloseOthers(menu.path);
              setMenu(null);
            }}
          >
            关闭其它标签页
          </button>
          <button
            className="tab-menu-item"
            onClick={() => {
              for (const t of [...tabs]) onClose(t.path);
              setMenu(null);
            }}
          >
            关闭全部
          </button>
        </div>
      )}
    </div>
  );
}

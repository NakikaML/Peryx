/**
 * 标签页栏：主面板与分屏共用。
 *
 * 交互：
 * - 点击切换、中键或 × 关闭
 * - 右键：关闭其它 / 关闭全部（仅主面板）
 * - 拖动标签页 → 拖到四边可以开分屏或移动过去
 * - 标题过长省略，悬停显示完整路径
 */

import { useEffect, useRef, useState } from "react";
import type { NoteTab } from "@/lib/types";
import { setDraggingTab } from "@/lib/tabDrag";

export type PaneId = "main" | "side";

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
                }
              }}
              onClick={() => {
                if (!active) onActivate(t.path);
              }}
              onContextMenu={(e) => {
                if (!onCloseOthers) return;
                e.preventDefault();
                setMenu({ path: t.path, x: e.clientX, y: e.clientY });
              }}
              draggable
              onDragStart={(e) => {
                setDraggingTab(t.path, pane);
                e.dataTransfer.effectAllowed = "copyMove";
                // 有些环境读不到自定义类型，同时写 text/plain 兜底
                e.dataTransfer.setData("application/x-peryx-tab", t.path);
                e.dataTransfer.setData("text/plain", t.path);
              }}
              onDragEnd={() => setDraggingTab(null, null)}
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

/**
 * 标签页栏：同时打开多篇笔记，类似 Obsidian。
 *
 * 交互：
 * - 点击切换、中键或 × 关闭
 * - 关闭当前标签会自动切到相邻标签
 * - 右键：关闭其它 / 关闭全部
 * - 标题过长省略，悬停显示完整路径
 */

import { useEffect, useRef, useState } from "react";
import { useStore } from "@/stores/app";

export function TabBar() {
  const tabs = useStore((s) => s.tabs);
  const note = useStore((s) => s.note);
  const imagePreview = useStore((s) => s.imagePreview);
  const openNote = useStore((s) => s.openNote);
  const closeTab = useStore((s) => s.closeTab);
  const closeOtherTabs = useStore((s) => s.closeOtherTabs);

  const listRef = useRef<HTMLDivElement | null>(null);
  const [menu, setMenu] = useState<{ path: string; x: number; y: number } | null>(null);

  const activePath = imagePreview ?? note?.path ?? null;

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

  if (tabs.length === 0) return null;

  return (
    <div className="tabbar">
      <div className="tabbar-list" ref={listRef}>
        {tabs.map((t) => {
          const active = t.path === activePath;
          return (
            <div
              key={t.path}
              data-tab-path={t.path}
              className={`tab ${active ? "active" : ""}`}
              title={t.path}
              onMouseDown={(e) => {
                if (e.button === 1) {
                  e.preventDefault();
                  void closeTab(t.path);
                }
              }}
              onClick={() => {
                if (!active) void openNote(t.path);
              }}
              onContextMenu={(e) => {
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
                  void closeTab(t.path);
                }}
              >
                ×
              </button>
            </div>
          );
        })}
      </div>

      {menu && (
        <div
          className="tab-menu"
          style={{ left: menu.x, top: menu.y }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            className="tab-menu-item"
            onClick={() => {
              void closeOtherTabs(menu.path);
              setMenu(null);
            }}
          >
            关闭其它标签页
          </button>
          <button
            className="tab-menu-item"
            onClick={() => {
              void (async () => {
                for (const t of [...tabs]) await closeTab(t.path);
              })();
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

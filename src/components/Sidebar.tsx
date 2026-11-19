/** 左侧目录树 */

import { useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { useStore } from "@/stores/app";
import { errText, isTauri } from "@/lib/api";
import { TagView } from "@/components/TagView";
import type { FileNode } from "@/lib/types";

interface Props {
  onCreateNote: () => void;
  onCreateFolder: () => void;
  onCollapse: () => void;
  /** 打开设置面板 */
  onOpenSettings: () => void;
}

/** 从完整路径里取最后一段作为显示名 */
function baseName(p: string): string {
  const parts = p.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts[parts.length - 1] ?? p;
}

export function Sidebar({ onCreateNote, onCreateFolder, onCollapse, onOpenSettings }: Props) {
  const vault = useStore((s) => s.vault);
  const children = useStore((s) => s.children);
  const expanded = useStore((s) => s.expanded);
  const selected = useStore((s) => s.selectedPath);
  const toggleExpand = useStore((s) => s.toggleExpand);
  const openNote = useStore((s) => s.openNote);
  const showImage = useStore((s) => s.showImage);
  const setSidebarOpen = useStore((s) => s.setSidebarOpen);

  const recentVaults = useStore((s) => s.recentVaults);
  const switchVault = useStore((s) => s.switchVault);
  const forgetRecent = useStore((s) => s.forgetRecent);
  const loadRecent = useStore((s) => s.loadRecent);
  const closeVault = useStore((s) => s.closeVault);
  const toast = useStore((s) => s.toast);

  const [menuOpen, setMenuOpen] = useState(false);
  /** 侧边栏视图：文件树 / 标签 */
  const [view, setView] = useState<"files" | "tags">("files");

  const rootChildren = children[""] ?? [];

  /** 选择别的文件夹作为笔记库 */
  const pickVault = async () => {
    setMenuOpen(false);
    if (!isTauri) {
      toast("当前不在桌面应用中运行", "error");
      return;
    }
    try {
      const picked = await openDialog({
        directory: true,
        multiple: false,
        title: "选择笔记库文件夹",
      });
      if (typeof picked === "string") await switchVault(picked);
    } catch (e) {
      toast(errText(e), "error");
    }
  };

  /** 新建笔记库 */
  const createVault = async () => {
    setMenuOpen(false);
    if (!isTauri) return;
    try {
      const picked = await openDialog({
        directory: true,
        multiple: false,
        title: "选择要创建笔记库的父文件夹",
      });
      if (typeof picked !== "string") return;
      const name = window.prompt("新笔记库的名称：", "我的笔记库");
      if (!name?.trim()) return;
      const full = `${picked}\\${name.trim()}`;
      await invoke("create_vault_dir", { path: full });
      await switchVault(full);
    } catch (e) {
      toast(errText(e), "error");
    }
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <button
          className="vault-name vault-switch"
          title={`${vault?.root ?? ""}\n点击切换笔记库`}
          onClick={() => {
            void loadRecent();
            setMenuOpen((v) => !v);
          }}
        >
          <span className="vault-icon">🪶</span>
          <span className="vault-text">{vault?.name ?? "未打开笔记库"}</span>
          <span className="vault-caret">▾</span>
        </button>
        <div className="sidebar-actions">
          <button className="icon-btn" title="新建笔记" onClick={onCreateNote}>
            ＋
          </button>
          <button className="icon-btn" title="新建文件夹" onClick={onCreateFolder}>
            📁
          </button>
          <button className="icon-btn" title="收起侧边栏" onClick={onCollapse}>
            «
          </button>
        </div>
      </div>

      {menuOpen && (
        <div className="ctx-mask" onMouseDown={() => setMenuOpen(false)}>
          <div className="vault-menu" onMouseDown={(e) => e.stopPropagation()}>
            <div className="vault-menu-title">切换笔记库</div>
            <div className="vault-menu-list">
              {recentVaults.length === 0 && (
                <div className="vault-menu-empty">还没有其他笔记库</div>
              )}
              {recentVaults.map((p) => {
                const active =
                  !!vault && vault.root.replace(/\\/g, "/").toLowerCase() === p.replace(/\\/g, "/").toLowerCase();
                return (
                  <div key={p} className={`vault-item ${active ? "active" : ""}`}>
                    <button
                      className="vault-item-main"
                      disabled={active}
                      title={p}
                      onClick={() => {
                        setMenuOpen(false);
                        void switchVault(p);
                      }}
                    >
                      <span className="vault-item-name">{baseName(p)}</span>
                      <span className="vault-item-path">{p}</span>
                    </button>
                    {active && <span className="vault-item-badge">当前</span>}
                    <button
                      className="vault-item-del"
                      title="从列表移除（不会删除文件）"
                      onClick={(e) => {
                        e.stopPropagation();
                        void forgetRecent(p);
                      }}
                    >
                      ✕
                    </button>
                  </div>
                );
              })}
            </div>
            <div className="vault-menu-sep" />
            <button className="vault-menu-action" onClick={pickVault}>
              <span>📂</span> 打开其他文件夹…
            </button>
            <button className="vault-menu-action" onClick={createVault}>
              <span>✨</span> 新建笔记库…
            </button>
            {vault && (
              <button
                className="vault-menu-action danger"
                onClick={() => {
                  setMenuOpen(false);
                  void closeVault();
                }}
              >
                <span>⏏</span> 关闭当前笔记库
              </button>
            )}
          </div>
        </div>
      )}

      <div className="tree" onClick={() => setSidebarOpen(true)}>
        <div className="sidebar-tabs">
          <button
            className={`sidebar-tab ${view === "files" ? "active" : ""}`}
            onClick={() => setView("files")}
          >
            文件
          </button>
          <button
            className={`sidebar-tab ${view === "tags" ? "active" : ""}`}
            onClick={() => setView("tags")}
          >
            标签
          </button>
        </div>
        {view === "tags" ? (
          <TagView />
        ) : (
          <>
            {rootChildren.length === 0 && (
              <div className="tree-empty">
                这个笔记库还没有内容
                <button className="link-btn" onClick={onCreateNote}>
                  新建第一篇笔记
                </button>
              </div>
            )}
            {rootChildren.map((node) => (
              <TreeItem
                key={node.path}
                node={node}
                depth={0}
                childrenMap={children}
                expanded={expanded}
                selected={selected}
                onToggle={toggleExpand}
                onOpen={openNote}
                onOpenImage={showImage}
              />
            ))}
          </>
        )}
      </div>

      <div className="sidebar-foot">
        <button className="settings-btn" title="设置（Alt+0）" onClick={onOpenSettings}>
          <span className="settings-icon">⚙</span>
          <span className="settings-text">设置</span>
        </button>
        <span className="hint">Ctrl+N 新建 · Ctrl+S 保存</span>
      </div>
    </aside>
  );
}

interface ItemProps {
  node: FileNode;
  depth: number;
  childrenMap: Record<string, FileNode[]>;
  expanded: Record<string, true>;
  selected: string | null;
  onToggle: (path: string) => void;
  onOpen: (path: string) => void;
  /** 点击图片文件：在右侧预览 */
  onOpenImage: (path: string) => void;
}

/** 当前正在拖拽的条目（模块级，避免层层传参） */
let currentDrag: { path: string; parentDir: string } | null = null;

/** 去掉路径最后一段，得到所在目录 */
function dirOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i < 0 ? "" : path.slice(0, i);
}

/** 取路径最后一段（文件名/文件夹名） */
function nameOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i < 0 ? path : path.slice(i + 1);
}

function TreeItem({ node, depth, childrenMap, expanded, selected, onToggle, onOpen, onOpenImage }: ItemProps) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [drop, setDrop] = useState<{ after: boolean } | null>(null);
  const [sortMode, setSortMode] = useState<"name" | "manual">("name");
  const isOpen = !!expanded[node.path];
  const isSelected = selected === node.path;
  const kids = childrenMap[node.path];

  const rename = useStore((s) => s.rename);
  const remove = useStore((s) => s.remove);
  const createNote = useStore((s) => s.createNote);
  const createFolder = useStore((s) => s.createFolder);
  const selectFolder = useStore((s) => s.selectFolder);
  const getSortMode = useStore((s) => s.getSortMode);
  const setSortModeAction = useStore((s) => s.setSortMode);
  const applyOrder = useStore((s) => s.applyOrder);

  const parentDir = dirOf(node.path);

  /** 文件夹：只切换展开/折叠并选中，绝不读取内容；文件：打开笔记 */
  const activate = () => {
    if (node.isDir) {
      selectFolder(node.path);
      onToggle(node.path);
    } else if (node.isImage) {
      // 图片：在右侧预览，不当成笔记打开
      onOpenImage(node.path);
    } else {
      onOpen(node.path);
    }
  };

  const openMenuAt = (e: React.MouseEvent) => {
    setMenu({
      x: Math.min(e.clientX, window.innerWidth - 190),
      y: Math.min(e.clientY, window.innerHeight - 260),
    });
    if (node.isDir) {
      void getSortMode(node.path).then(setSortMode);
    }
  };

  const handleContext = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    openMenuAt(e);
  };

  const doRename = () => {
    setMenu(null);
    const current = node.isDir ? node.name : node.name.replace(/\.md$/i, "");
    const next = window.prompt("重命名为：", current);
    if (next && next.trim() && next.trim() !== current) {
      const name = node.isDir ? next.trim() : `${next.trim()}.md`;
      void rename(node.path, name);
    }
  };

  const doDelete = () => {
    setMenu(null);
    const what = node.isDir ? "文件夹及其全部内容" : "这篇笔记";
    if (window.confirm(`确定删除${what}「${node.name}」吗？此操作不可撤销。`)) {
      void remove(node.path);
    }
  };

  // ---- 拖拽排序 ----
  const onDragStart = (e: React.DragEvent) => {
    currentDrag = { path: node.path, parentDir };
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", node.path);
    // 让拖动时的半透明预览更好看
    (e.currentTarget as HTMLElement).classList.add("dragging");
  };

  const onDragEnd = (e: React.DragEvent) => {
    currentDrag = null;
    (e.currentTarget as HTMLElement).classList.remove("dragging");
    setDrop(null);
  };

  const onDragOver = (e: React.DragEvent) => {
    if (!currentDrag) return;
    if (currentDrag.parentDir !== parentDir) return; // 只允许同目录内排序
    if (currentDrag.path === node.path) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setDrop({ after: e.clientY > r.top + r.height / 2 });
  };

  const onDragLeave = () => setDrop(null);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const after = drop?.after ?? false;
    setDrop(null);
    const drag = currentDrag;
    currentDrag = null;
    if (!drag || drag.parentDir !== parentDir || drag.path === node.path) return;

    const siblings = childrenMap[parentDir] ?? [];
    const rest = siblings.map((s) => s.path).filter((p) => p !== drag.path);
    const targetIdx = rest.indexOf(node.path);
    if (targetIdx < 0) return;
    const insertAt = after ? targetIdx + 1 : targetIdx;
    const newOrder = [...rest.slice(0, insertAt), drag.path, ...rest.slice(insertAt)];
    // 保存为文件名（后端按名称记录）
    void applyOrder(parentDir, newOrder.map(nameOf));
  };

  return (
    <>
      <div
        className={`tree-item ${isSelected ? "selected" : ""} ${node.isDir ? "is-dir" : ""} ${
          drop ? (drop.after ? "drop-after" : "drop-before") : ""
        }`}
        style={{ paddingLeft: 6 + depth * 14 }}
        onClick={activate}
        onContextMenu={handleContext}
        title={node.path}
        draggable
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        {node.isDir ? (
          <span className={`caret ${isOpen ? "open" : ""}`}>▸</span>
        ) : (
          <span className="caret-spacer" />
        )}
        <span className={`tree-icon ${node.isImage ? "is-image" : ""}`}>{node.isDir ? (isOpen ? "📂" : "📁") : node.isImage ? "🖼" : "📄"}</span>
        <span className="tree-label">{node.isDir ? node.name : node.name.replace(/\.md$/i, "")}</span>
        <button
          className="tree-more"
          title="更多操作"
          onClick={(e) => {
            e.stopPropagation();
            openMenuAt(e);
          }}
        >
          ⋯
        </button>
      </div>

      {menu && (
        <div className="ctx-mask" onMouseDown={() => setMenu(null)}>
          <div
            className="ctx-menu"
            onMouseDown={(e) => e.stopPropagation()}
            style={{ top: menu.y, left: menu.x }}
          >
            {node.isDir && (
              <>
                <button onClick={() => { setMenu(null); void createNote(node.path); }}>
                  ＋ 新建笔记
                </button>
                <button onClick={() => { setMenu(null); void createFolder(node.path); }}>
                  📁 新建子文件夹
                </button>
                <div className="ctx-sep" />
                <button
                  className={sortMode === "name" ? "ctx-checked" : ""}
                  onClick={() => {
                    setMenu(null);
                    void setSortModeAction(node.path, "name");
                  }}
                >
                  {sortMode === "name" ? "✓ " : "　"}按名称排序（自然顺序）
                </button>
                <button
                  className={sortMode === "manual" ? "ctx-checked" : ""}
                  onClick={() => {
                    setMenu(null);
                    void setSortModeAction(node.path, "manual");
                  }}
                >
                  {sortMode === "manual" ? "✓ " : "　"}手动排序（拖动调整）
                </button>
                <div className="ctx-sep" />
              </>
            )}
            <button onClick={doRename}>✏️ 重命名</button>
            <button className="danger" onClick={doDelete}>🗑 删除</button>
          </div>
        </div>
      )}

      {node.isDir && isOpen && kids && (
        <div>
          {kids.length === 0 && (
            <div className="tree-empty-child" style={{ paddingLeft: 20 + depth * 14 }}>
              空文件夹
            </div>
          )}
          {kids.map((child) => (
            <TreeItem
              key={child.path}
              node={child}
              depth={depth + 1}
              childrenMap={childrenMap}
              expanded={expanded}
              selected={selected}
              onToggle={onToggle}
              onOpen={onOpen}
              onOpenImage={onOpenImage}
            />
          ))}
        </div>
      )}
    </>
  );
}

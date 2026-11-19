/** 主应用 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { EditorView } from "@codemirror/view";
import { MarkdownEditor } from "@/editor/MarkdownEditor";
import type { EditorHandle } from "@/editor/MarkdownEditor";
import { Toolbar } from "@/components/Toolbar";
import { Sidebar } from "@/components/Sidebar";
import { Welcome } from "@/components/Welcome";
import { StatusBar } from "@/components/StatusBar";
import { Toasts } from "@/components/Toasts";
import { RightSidebar } from "@/components/RightSidebar";

import { CommandPalette } from "@/components/CommandPalette";
import { ContentSearch } from "@/components/ContentSearch";
import { SettingsPanel } from "@/components/SettingsPanel";
import { ImagePreview } from "@/components/ImagePreview";
import { ReadingView } from "@/components/ReadingView";
import { TabBar } from "@/components/TabBar";
import { applySettings, defaultSettings, loadSettings, matchShortcut } from "@/lib/settings";
import type { Settings } from "@/lib/settings";
import { useStore } from "@/stores/app";
import { registerWikiActions } from "@/editor/livePreview";
import { refreshLinkIndex } from "@/lib/linkCache";

const AUTOSAVE_MS = 800;

export default function App() {
  const vault = useStore((s) => s.vault);
  const note = useStore((s) => s.note);
  const mode = useStore((s) => s.mode);
  const setMode = useStore((s) => s.setMode);
  const sidebarOpen = useStore((s) => s.sidebarOpen);
  const setSidebarOpen = useStore((s) => s.setSidebarOpen);
  const loadingNote = useStore((s) => s.loadingNote);
  const selectedPath = useStore((s) => s.selectedPath);
  const selectedIsDir = useStore((s) => s.selectedIsDir);
  const imagePreview = useStore((s) => s.imagePreview);
  const noteContent = note?.content ?? "";
  const noteDirty = note?.dirty ?? false;

  const setContent = useStore((s) => s.setContent);
  const save = useStore((s) => s.save);
  const loadVault = useStore((s) => s.loadVault);
  const createNote = useStore((s) => s.createNote);
  const createFolder = useStore((s) => s.createFolder);

  const editorRef = useRef<EditorHandle | null>(null);
  const [cursor, setCursor] = useState<{ line: number; col: number } | null>(null);
  const [saving, setSaving] = useState(false);
  /** 右侧边栏（大纲 / 反向链接 / 出链）是否展开 */
  const [rightOpen, setRightOpen] = useState(true);
  /** 覆盖层：命令面板 / 全局搜索 / 设置 */
  const [overlay, setOverlay] = useState<"palette" | "search" | "settings" | null>(null);
  const [showLineNumbers, setShowLineNumbers] = useState(false);
  /** 视口顶部所在行（0 基），供大纲跟随高亮 */
  const [scrollLine, setScrollLine] = useState(0);
  /** 用户设置（字号 / 样式 / 快捷键） */
  const [settings, setSettings] = useState<Settings>(defaultSettings);

  // 启动时读取设置并立即应用
  useEffect(() => {
    void (async () => {
      const s = await loadSettings();
      setSettings(s);
      applySettings(s);
    })();
  }, []);

  // 启动时恢复上次打开的笔记库
  useEffect(() => {
    void loadVault();
  }, [loadVault]);

  // 注册双链点击动作（跳转已存在的笔记 / 新建缺失的笔记）
  useEffect(() => {
    registerWikiActions({
      open: (path) => {
        void useStore.getState().openNote(path);
      },
      filterTag: (tag) => {
        void useStore.getState().filterByTag(tag);
      },
      create: (target) => {
        const st = useStore.getState();
        void (async () => {
          // 新建在当前笔记所在目录，避免散落到根目录
          const dir = st.note?.path.includes("/")
            ? st.note.path.slice(0, st.note.path.lastIndexOf("/"))
            : "";
          await st.createNote(dir, target);
          await refreshLinkIndex();
        })();
      },
    });
  }, []);

  // 自动保存
  useEffect(() => {
    if (!noteDirty) return;
    const t = setTimeout(async () => {
      setSaving(true);
      await save();
      setSaving(false);
    }, AUTOSAVE_MS);
    return () => clearTimeout(t);
  }, [noteContent, noteDirty, save]);

  // 关闭窗口前保存
  useEffect(() => {
    const onBeforeUnload = () => {
      void useStore.getState().save();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  const getView = useCallback((): EditorView | null => editorRef.current?.view ?? null, []);

  // 全局快捷键：由设置驱动，可在设置面板里改
  useEffect(() => {
    const onKey = async (e: KeyboardEvent) => {
      const action = matchShortcut(e, settings.shortcuts);
      if (!action) return;
      const st = useStore.getState();

      switch (action) {
        case "sidebar":
          e.preventDefault();
          setSidebarOpen(!st.sidebarOpen);
          break;
        case "rightSidebar":
          e.preventDefault();
          setRightOpen((v) => !v);
          break;
        case "settings":
          e.preventDefault();
          setOverlay((cur) => (cur === "settings" ? null : "settings"));
          break;
        case "newNote": {
          e.preventDefault();
          const dir = st.note ? st.note.path.split("/").slice(0, -1).join("/") : "";
          await st.createNote(dir);
          break;
        }
        case "newFolder": {
          e.preventDefault();
          const dir = st.note ? st.note.path.split("/").slice(0, -1).join("/") : "";
          await st.createFolder(dir);
          break;
        }
        case "save":
          e.preventDefault();
          await st.save();
          break;
        case "toggleMode":
          e.preventDefault();
          setMode(useStore.getState().mode === "live" ? "source" : "live");
          break;
        case "commandPalette":
          e.preventDefault();
          setOverlay((cur) => (cur === "palette" ? null : "palette"));
          break;
        case "globalSearch":
          e.preventDefault();
          setOverlay((cur) => (cur === "search" ? null : "search"));
          break;
        case "refresh":
          e.preventDefault();
          await st.refresh("");
          break;
        default:
          // bold / italic / inlineCode 由工具栏的编辑器级快捷键处理
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [settings.shortcuts, setMode, setSidebarOpen]);

  const handleCreateNote = async () => {
    const st = useStore.getState();
    const dir = st.note ? st.note.path.split("/").slice(0, -1).join("/") : "";
    await createNote(dir);
  };

  const handleCreateFolder = async () => {
    const st = useStore.getState();
    const dir = st.note ? st.note.path.split("/").slice(0, -1).join("/") : "";
    await createFolder(dir);
  };

  if (!vault) {
    return (
      <>
        <Welcome />
        <Toasts />
      </>
    );
  }

  // 正文第一行已是同名 H1 时，不再重复显示标题栏
  const firstLine = note?.content.split("\n").find((l) => l.trim()) ?? "";
  const hasOwnH1 = /^#\s+/.test(firstLine.trim());

  return (
    <div className="app">
      {sidebarOpen ? (
        <Sidebar
          onCreateNote={handleCreateNote}
          onCreateFolder={handleCreateFolder}
          onCollapse={() => setSidebarOpen(false)}
          onOpenSettings={() => setOverlay("settings")}
        />
      ) : (
        <button className="sidebar-expand" title="展开侧边栏" onClick={() => setSidebarOpen(true)}>
          »
        </button>
      )}

      <main className="main">
        <Toolbar getView={getView} mode={mode} onModeChange={setMode} />

        <div className="workspace">
          <div className="editor-wrap">
            <TabBar />
            {imagePreview ? (
              <ImagePreview path={imagePreview} />
            ) : note ? (
              <>
                <div className="note-head">
                  {!hasOwnH1 && <h1 className="note-title">{note.title}</h1>}
                  {hasOwnH1 && <span />}
                  <div className="note-head-actions">
                    <button
                      className={`icon-btn ${showLineNumbers ? "on" : ""}`}
                      title="显示行号"
                      onClick={() => setShowLineNumbers((v) => !v)}
                    >
                      #
                    </button>
                    <button
                      className={`icon-btn ${rightOpen ? "on" : ""}`}
                      title="显示右侧边栏（Alt+4）"
                      onClick={() => setRightOpen((v) => !v)}
                    >
                      ☰
                    </button>
                  </div>
                </div>
                {loadingNote ? (
                  <div className="editor-loading">正在加载…</div>
                ) : mode === "read" ? (
                  <ReadingView
                    source={note.content}
                    docPath={note.path}
                    onOpenLink={(path) => void useStore.getState().openNote(path)}
                    onCreateLink={(target) => {
                      const st = useStore.getState();
                      const dir = st.note?.path.includes("/")
                        ? st.note.path.slice(0, st.note.path.lastIndexOf("/"))
                        : "";
                      void (async () => {
                        await st.createNote(dir, target);
                        await refreshLinkIndex();
                      })();
                    }}
                    onTagClick={(tag) => void useStore.getState().filterByTag(tag)}
                    onRequestEdit={() => setMode("live")}
                  />
                ) : (
                  <MarkdownEditor
                    ref={editorRef}
                    docPath={note.path}
                    value={note.content}
                    mode={mode}
                    showLineNumbers={showLineNumbers}
                    onChange={setContent}
                    onSave={() => void save()}
                    onCursor={(line, col) => setCursor({ line, col })}
                    onScrollLine={setScrollLine}
                  />
                )}
              </>
            ) : selectedIsDir ? (
              <FolderState
                name={selectedPath ?? ""}
                onCreateNote={() => void handleCreateNote()}
                onCreateFolder={() => void handleCreateFolder()}
              />
            ) : (
              <EmptyState onCreate={() => void handleCreateNote()} />
            )}
          </div>

          {note && rightOpen && (
            <RightSidebar
              source={note.content}
              onJumpLine={(line) => {
                const view = getView();
                if (!view) return;
                const doc = view.state.doc;
                const target = doc.line(Math.min(line + 1, doc.lines));
                view.dispatch({ selection: { anchor: target.from }, scrollIntoView: true });
                view.focus();
              }}
              onJumpNote={(path, line) => {
                void (async () => {
                  await useStore.getState().openNote(path);
                  // 等编辑器把新内容装进去再定位
                  requestAnimationFrame(() => {
                    const view = getView();
                    if (!view) return;
                    const doc = view.state.doc;
                    const target = doc.line(Math.min(line, doc.lines));
                    view.dispatch({ selection: { anchor: target.from }, scrollIntoView: true });
                    view.focus();
                  });
                })();
              }}
              onClose={() => setRightOpen(false)}
            activeLine={scrollLine}
            />
          )}
        </div>

        <StatusBar cursor={cursor} saving={saving} />
      </main>

      {overlay === "palette" && <CommandPalette onClose={() => setOverlay(null)} />}
      {overlay === "search" && (
        <ContentSearch
          onClose={() => setOverlay(null)}
          onJump={(path, line) => {
            void (async () => {
              await useStore.getState().openNote(path);
              requestAnimationFrame(() => {
                const view = getView();
                if (!view) return;
                const doc = view.state.doc;
                const target = doc.line(Math.min(line, doc.lines));
                view.dispatch({ selection: { anchor: target.from }, scrollIntoView: true });
                view.focus();
              });
            })();
          }}
        />
      )}

      {overlay === "settings" && (
        <SettingsPanel
          settings={settings}
          onChange={setSettings}
          onClose={() => setOverlay(null)}
        />
      )}

      <Toasts />
    </div>
  );
}

function FolderState({
  name,
  onCreateNote,
  onCreateFolder,
}: {
  name: string;
  onCreateNote: () => void;
  onCreateFolder: () => void;
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon">📁</div>
      <p className="folder-title">{name || "笔记库根目录"}</p>
      <p className="folder-sub">已选中文件夹。新笔记会创建在这个文件夹里。</p>
      <div className="empty-actions">
        <button className="btn-primary" onClick={onCreateNote}>
          在此新建笔记
        </button>
        <button className="btn-ghost" onClick={onCreateFolder}>
          新建子文件夹
        </button>
      </div>
      <div className="empty-hints">
        从左侧点击一篇笔记即可开始编辑
      </div>
    </div>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="empty-state">
      <div className="empty-icon">🪶</div>
      <p>从左侧选择一篇笔记，或新建一篇</p>
      <button className="btn-primary" onClick={onCreate}>
        新建笔记
      </button>
      <div className="empty-hints">
        <kbd>Ctrl</kbd> + <kbd>N</kbd> 新建笔记 &nbsp;·&nbsp; <kbd>Ctrl</kbd> + <kbd>S</kbd> 保存
        &nbsp;·&nbsp; <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>P</kbd> 切换渲染模式
      </div>
    </div>
  );
}

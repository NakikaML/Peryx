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
import { Outline } from "@/components/Outline";
import { LinksPanel } from "@/components/LinksPanel";
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
  const noteContent = note?.content ?? "";
  const noteDirty = note?.dirty ?? false;

  const setContent = useStore((s) => s.setContent);
  const save = useStore((s) => s.save);
  const loadVault = useStore((s) => s.loadVault);
  const refresh = useStore((s) => s.refresh);
  const createNote = useStore((s) => s.createNote);
  const createFolder = useStore((s) => s.createFolder);

  const editorRef = useRef<EditorHandle | null>(null);
  const [cursor, setCursor] = useState<{ line: number; col: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [showOutline, setShowOutline] = useState(true);
  const [showLinks, setShowLinks] = useState(true);
  const [showLineNumbers, setShowLineNumbers] = useState(false);

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

  // 全局快捷键
  useEffect(() => {
    const onKey = async (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const k = e.key.toLowerCase();
      if (k === "n" && !e.shiftKey) {
        e.preventDefault();
        const st = useStore.getState();
        const dir = st.note ? st.note.path.split("/").slice(0, -1).join("/") : "";
        await st.createNote(dir);
      } else if (k === "n" && e.shiftKey) {
        e.preventDefault();
        const st = useStore.getState();
        const dir = st.note ? st.note.path.split("/").slice(0, -1).join("/") : "";
        await st.createFolder(dir);
      } else if (k === "s") {
        e.preventDefault();
        await useStore.getState().save();
      } else if (k === "p" && e.shiftKey) {
        e.preventDefault();
        setMode(useStore.getState().mode === "live" ? "source" : "live");
      } else if (k === "o") {
        e.preventDefault();
        await refresh("");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setMode, refresh]);

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
            {note ? (
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
                      className={`icon-btn ${showOutline ? "on" : ""}`}
                      title="显示大纲"
                      onClick={() => setShowOutline((v) => !v)}
                    >
                      ☰
                    </button>
                    <button
                      className={`icon-btn ${showLinks ? "on" : ""}`}
                      title="显示链接面板（反向链接 / 出链）"
                      onClick={() => setShowLinks((v) => !v)}
                    >
                      🔗
                    </button>
                  </div>
                </div>
                {loadingNote ? (
                  <div className="editor-loading">正在加载…</div>
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

          {note && showOutline && <Outline source={note.content} onJump={(line) => {
            const view = getView();
            if (!view) return;
            const doc = view.state.doc;
            const target = doc.line(Math.min(line + 1, doc.lines));
            view.dispatch({ selection: { anchor: target.from }, scrollIntoView: true });
            view.focus();
          }} />}

          {note && showLinks && (
            <LinksPanel
              onJump={(path, line) => {
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
            />
          )}
        </div>

        <StatusBar cursor={cursor} saving={saving} />
      </main>

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

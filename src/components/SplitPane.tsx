/**
 * 分屏面板：右侧再开一个编辑器，用于对照两篇笔记（类似 Obsidian 的分栏）。
 *
 * 设计取舍：**不把第二篇笔记塞进全局 store**。
 * store 里的 `note` 仍然只代表主面板；分屏自己读盘、自己保存，
 * 这样避免了「两个面板抢同一份 note 状态」的脏数据问题。
 */

import { useEffect, useRef, useState } from "react";
import { MarkdownEditor } from "@/editor/MarkdownEditor";
import type { EditorHandle } from "@/editor/MarkdownEditor";
import { api, errText } from "@/lib/api";
import { ReadingView } from "@/components/ReadingView";
import type { EditorMode } from "@/lib/types";
import type { SplitSide } from "@/lib/tabDrag";
import { TabStrip } from "@/components/TabStrip";
import { PaneModeSwitch } from "@/components/PaneModeSwitch";
import { useStore } from "@/stores/app";

interface Props {
  path: string;
  /** 分屏位置：决定边框画在哪个方向 */
  side?: SplitSide;
  onClose: () => void;
  /** 滚到某一行（0 基） */
  onJumpLine?: (line: number) => void;
}

const AUTOSAVE_MS = 800;

export function SplitPane({ path, side = "right", onClose }: Props) {
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<EditorMode>("live");
  const editorRef = useRef<EditorHandle | null>(null);
  const dirtyRef = useRef(false);
  const timerRef = useRef<number | null>(null);

  const title = path.replace(/\.md$/i, "").split("/").pop() ?? path;
  const splitTabs = useStore((s) => s.splitTabs);
  const activateSplitTab = useStore((s) => s.activateSplitTab);
  const closeSplitTab = useStore((s) => s.closeSplitTab);

  // 读盘
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    dirtyRef.current = false;
    void api
      .readNote(path)
      .then((text) => {
        if (cancelled) return;
        setContent(text);
        setLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(errText(e));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  // 卸载前把未保存的改动落盘
  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
      if (dirtyRef.current) void api.writeNote(path, content).catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  const onChange = (next: string) => {
    setContent(next);
    dirtyRef.current = true;
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      void api
        .writeNote(path, next)
        .then(() => {
          dirtyRef.current = false;
        })
        .catch((e) => setError(errText(e)));
    }, AUTOSAVE_MS);
  };

  const saveNow = () => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    void api
      .writeNote(path, content)
      .then(() => {
        dirtyRef.current = false;
      })
      .catch((e) => setError(errText(e)));
  };

  return (
    <div className={`split-pane split-${side}`}>
      <TabStrip
        pane="side"
        tabs={splitTabs}
        activePath={path}
        onActivate={(p) => activateSplitTab(p)}
        onClose={(p) => closeSplitTab(p)}
        onClosePane={onClose}
      />

      <div className="split-head">
        <span className="split-title" title={path}>
          ⬒ {title}
        </span>
        <div className="split-actions">
          <PaneModeSwitch mode={mode} onChange={setMode} compact />
          <button className="icon-btn" title="保存" onClick={saveNow}>
            💾
          </button>
        </div>
      </div>

      <div className="split-body">
        {loading && <div className="editor-loading">正在加载…</div>}
        {!loading && error && (
          <div className="image-preview-error" style={{ padding: 20 }}>
            ⚠ {error}
          </div>
        )}
        {!loading && !error && mode === "read" && (
          <ReadingView
            source={content}
            docPath={path}
            onRequestEdit={() => setMode("live")}
          />
        )}
        {!loading && !error && mode !== "read" && (
          <MarkdownEditor
            ref={editorRef}
            docPath={path}
            value={content}
            mode={mode}
            showLineNumbers={false}
            onChange={onChange}
            onSave={saveNow}
          />
        )}
      </div>
    </div>
  );
}

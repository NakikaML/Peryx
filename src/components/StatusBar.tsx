/** 状态栏：字数、保存状态、光标位置 */

import { useStore } from "@/stores/app";
import { countWords } from "@/lib/markdown";
import { useMemo } from "react";

interface Props {
  cursor: { line: number; col: number } | null;
  saving: boolean;
}

export function StatusBar({ cursor, saving }: Props) {
  const note = useStore((s) => s.note);
  const mode = useStore((s) => s.mode);

  const stats = useMemo(() => (note ? countWords(note.content) : null), [note?.content]);

  return (
    <div className="statusbar">
      <span className="sb-item">{mode === "live" ? "实时渲染" : "源码模式"}</span>
      {note && (
        <span className="sb-item" title={note.path}>
          {note.path}
        </span>
      )}
      <span className="sb-spacer" />
      {cursor && (
        <span className="sb-item">
          第 {cursor.line} 行，第 {cursor.col} 列
        </span>
      )}
      {stats && (
        <span className="sb-item">
          {stats.words} 字 · {stats.lines} 行
        </span>
      )}
      <span className={`sb-item sb-state ${note?.dirty ? "dirty" : ""}`}>
        {saving ? "保存中…" : note?.dirty ? "未保存" : note ? "已保存" : ""}
      </span>
    </div>
  );
}

/** 大纲面板：显示当前笔记的标题结构，可点击跳转 */

import { useMemo } from "react";
import { extractHeadings } from "@/lib/markdown";

interface Props {
  source: string;
  onJump: (line: number) => void;
}

export function Outline({ source, onJump }: Props) {
  const headings = useMemo(() => extractHeadings(source), [source]);

  return (
    <aside className="outline">
      <div className="outline-head">大纲</div>
      <div className="outline-list">
        {headings.length === 0 && <div className="outline-empty">添加 # 标题后会显示在这里</div>}
        {headings.map((h, i) => (
          <button
            key={`${h.line}-${i}`}
            className={`outline-item lv${h.level}`}
            style={{ paddingLeft: 10 + (h.level - 1) * 14 }}
            title={h.text}
            onClick={() => onJump(h.line)}
          >
            {h.text || "(空标题)"}
          </button>
        ))}
      </div>
    </aside>
  );
}

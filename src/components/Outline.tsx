/** 大纲面板：显示当前笔记的标题结构，可点击跳转；滚动时跟随高亮当前章节 */

import { useEffect, useMemo, useRef } from "react";
import { extractHeadings } from "@/lib/markdown";

interface Props {
  source: string;
  /** 视口顶部所在行（0 基），用于跟随高亮 */
  activeLine?: number;
  onJump: (line: number) => void;
}

export function Outline({ source, activeLine, onJump }: Props) {
  const headings = useMemo(() => extractHeadings(source), [source]);
  const listRef = useRef<HTMLDivElement | null>(null);

  /**
   * 当前章节：最后一个「起始行 ≤ 视口顶部行」的标题。
   * 视口在任何标题之前时不亮任何一项。
   */
  const activeIndex = useMemo(() => {
    if (activeLine === undefined) return -1;
    let idx = -1;
    for (let i = 0; i < headings.length; i++) {
      if (headings[i].line <= activeLine) idx = i;
      else break;
    }
    return idx;
  }, [headings, activeLine]);

  // 让高亮项始终在可视区域内（不抢用户的鼠标滚动）
  useEffect(() => {
    if (activeIndex < 0 || !listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(
      `[data-outline-index="${activeIndex}"]`,
    );
    if (!el) return;
    const box = listRef.current;
    const top = el.offsetTop;
    const bottom = top + el.offsetHeight;
    if (top < box.scrollTop || bottom > box.scrollTop + box.clientHeight) {
      box.scrollTop = Math.max(0, top - box.clientHeight / 2);
    }
  }, [activeIndex]);

  return (
    <aside className="outline">
      <div className="outline-head">大纲</div>
      <div className="outline-list" ref={listRef}>
        {headings.length === 0 && <div className="outline-empty">添加 # 标题后会显示在这里</div>}
        {headings.map((h, i) => (
          <button
            key={`${h.line}-${i}`}
            data-outline-index={i}
            className={`outline-item lv${h.level} ${i === activeIndex ? "active" : ""}`}
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

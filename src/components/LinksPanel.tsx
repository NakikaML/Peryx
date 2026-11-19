/** 右侧「链接」面板：反向链接（谁引用了我）+ 出链（我引用了谁） */

import { useState } from "react";
import { useStore } from "@/stores/app";
import type { ContextHit } from "@/lib/types";

interface Props {
  /** 跳转到某篇笔记的指定行（行号从 1 开始） */
  onJump: (path: string, line: number) => void;
}

/** 把片段按匹配区间切分，高亮命中部分 */
function Snippet({ hit }: { hit: ContextHit }) {
  const { snippet, matchStart, matchLen } = hit;
  if (matchLen <= 0 || matchStart < 0 || matchStart + matchLen > snippet.length) {
    return <span className="link-snippet">{snippet}</span>;
  }
  const before = snippet.slice(0, matchStart);
  const mid = snippet.slice(matchStart, matchStart + matchLen);
  const after = snippet.slice(matchStart + matchLen);
  return (
    <span className="link-snippet">
      {before}
      <mark className="link-hit">{mid}</mark>
      {after}
    </span>
  );
}

export function LinksPanel({ onJump }: Props) {
  const note = useStore((s) => s.note);
  const backlinks = useStore((s) => s.backlinks);
  const outlinks = useStore((s) => s.outlinks);
  const [tab, setTab] = useState<"back" | "out">("back");

  if (!note) return null;

  return (
    <aside className="links-panel">
      <div className="links-head">
        <button
          className={`links-tab ${tab === "back" ? "active" : ""}`}
          onClick={() => setTab("back")}
          title="哪些笔记引用了当前笔记"
        >
          反向链接
          {backlinks.length > 0 && <span className="links-count">{backlinks.length}</span>}
        </button>
        <button
          className={`links-tab ${tab === "out" ? "active" : ""}`}
          onClick={() => setTab("out")}
          title="当前笔记引用了哪些笔记"
        >
          出链
          {outlinks.length > 0 && <span className="links-count">{outlinks.length}</span>}
        </button>
      </div>

      <div className="links-body">
        {tab === "back" ? (
          backlinks.length === 0 ? (
            <div className="links-empty">
              还没有笔记引用这篇
              <div className="links-hint">在别的笔记里写 [[{note.title}]] 即可建立链接</div>
            </div>
          ) : (
            backlinks.map((h, i) => (
              <button
                key={`${h.path}-${h.line}-${i}`}
                className="link-item"
                title={`${h.path} 第 ${h.line} 行`}
                onClick={() => onJump(h.path, h.line)}
              >
                <div className="link-item-head">
                  <span className="link-item-title">{h.title}</span>
                  <span className="link-item-line">L{h.line}</span>
                </div>
                <Snippet hit={h} />
              </button>
            ))
          )
        ) : outlinks.length === 0 ? (
          <div className="links-empty">
            这篇笔记还没有链接到别处
            <div className="links-hint">输入 [[ 可以从现有笔记里选择</div>
          </div>
        ) : (
          outlinks.map((l, i) => (
            <div key={`${l.target}-${l.line}-${i}`} className="link-item outlink">
              <div className="link-item-head">
                <span className="link-item-title">{l.alias ?? l.target}</span>
                <span className="link-item-line">L{l.line}</span>
              </div>
              {l.alias && <div className="link-item-sub">→ {l.target}</div>}
            </div>
          ))
        )}
      </div>
    </aside>
  );
}

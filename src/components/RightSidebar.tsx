/**
 * 右侧边栏：大纲 / 反向链接 / 出链 三个标签页，类似 Obsidian。
 *
 * 之前大纲和链接面板是两个独立面板并排，挤占编辑区；
 * 合并成一个侧边栏后按标签切换，空间利用更合理。
 */

import { useState } from "react";
import { useStore } from "@/stores/app";
import { Outline } from "@/components/Outline";
import type { ContextHit } from "@/lib/types";

interface Props {
  /** 当前笔记正文（大纲用） */
  source: string;
  /** 跳转到当前笔记的某一行（大纲用，行号从 0 开始） */
  onJumpLine: (line: number) => void;
  /** 跳转到别的笔记的某一行（链接面板用，行号从 1 开始） */
  onJumpNote: (path: string, line: number) => void;
  onClose: () => void;
}

type Tab = "outline" | "back" | "out";

/** 片段高亮 */
function Snippet({ hit }: { hit: ContextHit }) {
  const { snippet, matchStart, matchLen } = hit;
  if (matchLen <= 0 || matchStart < 0 || matchStart + matchLen > snippet.length) {
    return <span className="link-snippet">{snippet}</span>;
  }
  return (
    <span className="link-snippet">
      {snippet.slice(0, matchStart)}
      <mark className="link-hit">{snippet.slice(matchStart, matchStart + matchLen)}</mark>
      {snippet.slice(matchStart + matchLen)}
    </span>
  );
}

export function RightSidebar({ source, onJumpLine, onJumpNote, onClose }: Props) {
  const [tab, setTab] = useState<Tab>("outline");
  const note = useStore((s) => s.note);
  const backlinks = useStore((s) => s.backlinks);
  const outlinks = useStore((s) => s.outlinks);

  return (
    <aside className="right-sidebar">
      <div className="right-tabs">
        <button
          className={`right-tab ${tab === "outline" ? "active" : ""}`}
          onClick={() => setTab("outline")}
          title="文档大纲"
        >
          大纲
        </button>
        <button
          className={`right-tab ${tab === "back" ? "active" : ""}`}
          onClick={() => setTab("back")}
          title="哪些笔记引用了当前笔记"
        >
          反向链接
          {backlinks.length > 0 && <span className="right-tab-count">{backlinks.length}</span>}
        </button>
        <button
          className={`right-tab ${tab === "out" ? "active" : ""}`}
          onClick={() => setTab("out")}
          title="当前笔记引用了哪些笔记"
        >
          出链
          {outlinks.length > 0 && <span className="right-tab-count">{outlinks.length}</span>}
        </button>
        <button className="right-close" title="收起右侧边栏 (Alt+4)" onClick={onClose}>
          »
        </button>
      </div>

      <div className="right-body">
        {tab === "outline" && (
          <div className="right-outline">
            <Outline source={source} onJump={onJumpLine} />
          </div>
        )}

        {tab === "back" &&
          (backlinks.length === 0 ? (
            <div className="links-empty">
              还没有笔记引用这篇
              <div className="links-hint">在别的笔记里写 [[{note?.title ?? "标题"}]] 即可建立链接</div>
            </div>
          ) : (
            <div className="right-list">
              {backlinks.map((h, i) => (
                <button
                  key={`${h.path}-${h.line}-${i}`}
                  className="link-item"
                  title={`${h.path} 第 ${h.line} 行`}
                  onClick={() => onJumpNote(h.path, h.line)}
                >
                  <div className="link-item-head">
                    <span className="link-item-title">{h.title}</span>
                    <span className="link-item-line">L{h.line}</span>
                  </div>
                  <Snippet hit={h} />
                </button>
              ))}
            </div>
          ))}

        {tab === "out" &&
          (outlinks.length === 0 ? (
            <div className="links-empty">
              这篇笔记还没有链接到别处
              <div className="links-hint">输入 [[ 可以从现有笔记里选择</div>
            </div>
          ) : (
            <div className="right-list">
              {outlinks.map((l, i) => (
                <div key={`${l.target}-${l.line}-${i}`} className="link-item outlink">
                  <div className="link-item-head">
                    <span className="link-item-title">{l.alias ?? l.target}</span>
                    <span className="link-item-line">L{l.line}</span>
                  </div>
                  {l.alias && <div className="link-item-sub">→ {l.target}</div>}
                </div>
              ))}
            </div>
          ))}
      </div>
    </aside>
  );
}

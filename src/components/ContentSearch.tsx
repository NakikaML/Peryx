/**
 * 全局搜索（Ctrl+Shift+F）：搜索所有笔记正文，显示上下文片段。
 *
 * 与命令面板（Ctrl+P，只搜标题）区分：这里搜的是内容。
 */

import { useEffect, useRef, useState } from "react";
import { api, errText } from "@/lib/api";
import type { ContextHit } from "@/lib/types";

interface Props {
  onClose: () => void;
  /** 跳转到某篇笔记的指定行（从 1 开始） */
  onJump: (path: string, line: number) => void;
}

/** 把片段按匹配区间高亮 */
function Highlight({ hit }: { hit: ContextHit }) {
  const { snippet, matchStart, matchLen } = hit;
  if (matchLen <= 0 || matchStart < 0 || matchStart + matchLen > snippet.length) {
    return <span className="gsearch-snippet">{snippet}</span>;
  }
  return (
    <span className="gsearch-snippet">
      {snippet.slice(0, matchStart)}
      <mark className="gsearch-hit">{snippet.slice(matchStart, matchStart + matchLen)}</mark>
      {snippet.slice(matchStart + matchLen)}
    </span>
  );
}

export function ContentSearch({ onClose, onJump }: Props) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<ContextHit[]>([]);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const activeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setHits([]);
      setSearched(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const res = await api.searchContent(q, 120);
        if (cancelled) return;
        setHits(res);
        setActive(0);
        setSearched(true);
        setError(null);
      } catch (e) {
        if (!cancelled) setError(errText(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  // 键盘移动时把选中项滚进视野
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, hits.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const pick = hits[active];
      if (pick) {
        onClose();
        onJump(pick.path, pick.line);
      }
    }
  };

  // 按笔记分组展示
  const groups: { path: string; title: string; items: ContextHit[] }[] = [];
  for (const h of hits) {
    const g = groups.find((x) => x.path === h.path);
    if (g) g.items.push(h);
    else groups.push({ path: h.path, title: h.title, items: [h] });
  }

  return (
    <div className="cmdk-mask" onMouseDown={onClose}>
      <div
        className="cmdk cmdk-wide"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <input
          ref={inputRef}
          className="cmdk-input"
          placeholder="搜索所有笔记的内容…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="cmdk-list cmdk-list-tall">
          {error && <div className="cmdk-empty error">{error}</div>}
          {!error && !query.trim() && (
            <div className="cmdk-empty">输入关键字后开始全文搜索</div>
          )}
          {!error && loading && hits.length === 0 && <div className="cmdk-empty">搜索中…</div>}
          {!error && searched && hits.length === 0 && !loading && (
            <div className="cmdk-empty">没有找到包含「{query.trim()}」的内容</div>
          )}
          {groups.map((g) => (
            <div key={g.path} className="gsearch-group">
              <div className="gsearch-group-head">
                <span className="gsearch-group-title">{g.title}</span>
                <span className="gsearch-group-count">{g.items.length} 处</span>
              </div>
              {g.items.map((h) => {
                const idx = hits.indexOf(h);
                return (
                  <button
                    key={`${h.path}-${h.line}`}
                    ref={idx === active ? activeRef : null}
                    className={`cmdk-item gsearch-item ${idx === active ? "active" : ""}`}
                    onMouseEnter={() => setActive(idx)}
                    onClick={() => {
                      onClose();
                      onJump(h.path, h.line);
                    }}
                    title={`${h.path} 第 ${h.line} 行`}
                  >
                    <span className="gsearch-line">L{h.line}</span>
                    <Highlight hit={h} />
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        <div className="cmdk-foot">
          <span>↑↓ 选择</span>
          <span>Enter 跳转</span>
          <span>Esc 关闭</span>
          <span className="cmdk-count">{hits.length} 处匹配</span>
        </div>
      </div>
    </div>
  );
}

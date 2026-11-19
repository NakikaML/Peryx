/**
 * 命令面板（Ctrl+P）：按标题 / 路径快速跳转笔记。
 *
 * 交互：输入即搜索，↑↓ 选择，Enter 打开，Esc 关闭。
 */

import { useEffect, useRef, useState } from "react";
import { useStore } from "@/stores/app";
import { api, errText } from "@/lib/api";
import { allNoteMetas } from "@/lib/linkCache";
import type { NoteHit } from "@/lib/types";

interface Props {
  onClose: () => void;
}

export function CommandPalette({ onClose }: Props) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<NoteHit[]>([]);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const openNote = useStore((s) => s.openNote);
  const toast = useStore((s) => s.toast);

  // 空查询时直接列出全部笔记（按路径排序），方便浏览。
  // 注意不要用 useMemo([]) 缓存：链接缓存在打开笔记库后才异步填充，
  // 首次渲染时可能还是空的，缓存住就再也不会更新了。
  const allNotes: NoteHit[] = allNoteMetas().map((n) => ({
    path: n.path,
    title: n.title,
    score: 0,
  }));

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // 查询变化时做防抖搜索
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setHits([]);
      setActive(0);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const res = await api.searchTitles(q, 40);
        if (cancelled) return;
        setHits(res);
        setActive(0);
      } catch (e) {
        if (!cancelled) toast(errText(e), "error");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 90);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, toast]);

  const list = query.trim() ? hits : allNotes;

  const choose = async (path: string) => {
    onClose();
    await openNote(path);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, list.length - 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const pick = list[active];
      if (pick) void choose(pick.path);
    }
  };

  return (
    <div className="cmdk-mask" onMouseDown={onClose}>
      <div className="cmdk" onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="cmdk-input"
          placeholder="搜索笔记标题或路径…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <div className="cmdk-list">
          {list.length === 0 && (
            <div className="cmdk-empty">
              {loading ? "搜索中…" : query.trim() ? "没有匹配的笔记" : "笔记库还没有笔记"}
            </div>
          )}
          {list.map((h, i) => (
            <button
              key={h.path}
              className={`cmdk-item ${i === active ? "active" : ""}`}
              onMouseEnter={() => setActive(i)}
              onClick={() => void choose(h.path)}
              title={h.path}
            >
              <span className="cmdk-title">{h.title}</span>
              <span className="cmdk-path">{h.path}</span>
            </button>
          ))}
        </div>
        <div className="cmdk-foot">
          <span>↑↓ 选择</span>
          <span>Enter 打开</span>
          <span>Esc 关闭</span>
          <span className="cmdk-count">{list.length} 篇</span>
        </div>
      </div>
    </div>
  );
}

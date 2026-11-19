/** 侧边栏「标签」视图：列出所有标签与数量，点击筛选笔记 */

import { useStore } from "@/stores/app";

export function TagView() {
  const tags = useStore((s) => s.tags);
  const tagFilter = useStore((s) => s.tagFilter);
  const taggedNotes = useStore((s) => s.taggedNotes);
  const filterByTag = useStore((s) => s.filterByTag);
  const renameTag = useStore((s) => s.renameTag);
  const openNote = useStore((s) => s.openNote);

  if (tags.length === 0) {
    return (
      <div className="tree-empty">
        笔记里还没有标签
        <div className="tag-hint">在正文里写 #标签 即可</div>
      </div>
    );
  }

  // 已选中某个标签 → 显示该标签下的笔记
  if (tagFilter) {
    return (
      <div className="tag-view">
        <div className="tag-filter-head">
          <button className="tag-back" onClick={() => void filterByTag(null)}>
            ‹ 全部标签
          </button>
          <span className="tag-filter-name">#{tagFilter}</span>
          <button
            className="tag-rename"
            title="重命名标签（会批量修改所有笔记）"
            onClick={() => {
              const next = window.prompt(`把 #${tagFilter} 重命名为：`, tagFilter);
              if (next?.trim()) void renameTag(tagFilter, next.trim());
            }}
          >
            ✏️
          </button>
        </div>
        <div className="tag-notes">
          {taggedNotes.length === 0 && <div className="tree-empty-child">没有笔记</div>}
          {taggedNotes.map((n) => (
            <button
              key={n.path}
              className="tag-note"
              title={n.path}
              onClick={() => void openNote(n.path)}
            >
              <span className="tree-icon">📄</span>
              <span className="tag-note-title">{n.title}</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="tag-view">
      <div className="tag-list">
        {tags.map((t) => (
          <button
            key={t.tag}
            className="tag-chip"
            title={`筛选出使用 #${t.tag} 的笔记`}
            onClick={() => void filterByTag(t.tag)}
          >
            <span className="tag-chip-name">#{t.tag}</span>
            <span className="tag-chip-count">{t.count}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

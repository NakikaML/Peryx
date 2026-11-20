/**
 * 笔记属性面板（YAML frontmatter）。
 *
 * 放在笔记标题下方、工具栏之上，与 Obsidian 的「属性」一致：
 * - 显示 frontmatter 里的每一项，可就地编辑
 * - 列表型（aliases / tags）用胶囊展示，回车添加、× 删除
 * - 可新增属性、删除属性
 * - 没有 frontmatter 时默认折叠，点「添加属性」才创建
 *
 * 改写走 lib/frontmatter.ts 的 setProperty：只动相关的行，
 * 不重排、不美化用户手写的 YAML。
 */

import { useMemo, useState } from "react";
import {
  parseFrontmatter,
  setProperty,
  type Property,
  type PropertyKind,
} from "@/lib/frontmatter";

interface Props {
  source: string;
  /** 改整篇文本（调用方负责写回与自动保存） */
  onChange: (next: string) => void;
}

/** 常用属性名（新增时给个下拉建议） */
const SUGGESTED_KEYS = [
  "title",
  "aliases",
  "tags",
  "subject",
  "subfield",
  "topic",
  "difficulty",
  "created_date",
  "modify_date",
];

export function PropertiesPanel({ source, onChange }: Props) {
  const fm = useMemo(() => parseFrontmatter(source), [source]);
  // 默认折叠：属性只是参考信息，不该一上来就占掉半屏
  const [collapsed, setCollapsed] = useState(true);
  const [adding, setAdding] = useState(false);
  const [newKey, setNewKey] = useState("");
  /** 正在编辑的列表项输入 */
  const [listDraft, setListDraft] = useState<{ key: string; text: string } | null>(null);

  const hasProps = fm.properties.length > 0;

  const updateText = (p: Property, value: string) => {
    onChange(setProperty(source, p.key, { value, kind: p.kind === "list" ? "text" : p.kind }));
  };

  const updateList = (p: Property, values: string[]) => {
    onChange(setProperty(source, p.key, { values, kind: "list" }));
  };

  const removeProp = (p: Property) => {
    onChange(setProperty(source, p.key, null));
  };

  const addProp = () => {
    const key = newKey.trim() || "新属性";
    const kind: PropertyKind =
      key.toLowerCase() === "aliases" || key.toLowerCase() === "tags" ? "list" : "text";
    onChange(
      setProperty(source, key, kind === "list" ? { values: [], kind } : { value: "", kind: "text" }),
    );
    setNewKey("");
    setAdding(false);
  };

  // 没有属性时不占地方，只留一个小的入口
  if (!hasProps && !adding) {
    return (
      <div className="props props-empty">
        <button className="props-add-trigger" onClick={() => setAdding(true)}>
          + 添加属性
        </button>
      </div>
    );
  }

  return (
    <div className={`props ${collapsed ? "collapsed" : ""}`}>
      <div className="props-head">
        <button className="props-toggle" onClick={() => setCollapsed((v) => !v)}>
          {collapsed ? "▸" : "▾"} 属性
          {hasProps && <span className="props-count">{fm.properties.length}</span>}
        </button>
        <button className="props-add-trigger" onClick={() => setAdding(true)}>
          + 添加
        </button>
      </div>

      {!collapsed && (
        <div className="props-list">
          {fm.properties.map((p) => {
            const isList = p.kind === "list";
            const isAlias = /^(aliases?|tags?)$/i.test(p.key);
            return (
              <div className="prop-row" key={p.key} data-prop-key={p.key}>
                <span className="prop-key" title={p.key}>
                  {p.key}
                </span>

                {isList || isAlias ? (
                  <span className="prop-values">
                    {p.values.map((v) => (
                      <span className="prop-chip" key={v}>
                        {v}
                        <button
                          className="prop-chip-x"
                          title="移除"
                          onClick={() => updateList(p, p.values.filter((x) => x !== v))}
                        >
                          ×
                        </button>
                      </span>
                    ))}
                    {listDraft?.key === p.key ? (
                      <input
                        className="prop-input prop-input-inline"
                        autoFocus
                        value={listDraft.text}
                        placeholder="回车添加"
                        onChange={(e) => setListDraft({ key: p.key, text: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            const v = listDraft.text.trim();
                            if (v) updateList(p, [...p.values, v]);
                            setListDraft(null);
                          } else if (e.key === "Escape") {
                            setListDraft(null);
                          }
                        }}
                        onBlur={() => setListDraft(null)}
                      />
                    ) : (
                      <button
                        className="prop-chip-add"
                        title="添加一项"
                        onClick={() => setListDraft({ key: p.key, text: "" })}
                      >
                        +
                      </button>
                    )}
                  </span>
                ) : (
                  <input
                    className="prop-input"
                    defaultValue={p.value}
                    onBlur={(e) => {
                      if (e.target.value !== p.value) updateText(p, e.target.value);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        (e.target as HTMLInputElement).blur();
                      }
                    }}
                  />
                )}

                <button className="prop-remove" title="删除该属性" onClick={() => removeProp(p)}>
                  ×
                </button>
              </div>
            );
          })}

          {adding && (
            <div className="prop-row prop-row-new">
              <input
                className="prop-input prop-key-input"
                autoFocus
                list="peryx-prop-keys"
                placeholder="属性名"
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") addProp();
                  else if (e.key === "Escape") {
                    setAdding(false);
                    setNewKey("");
                  }
                }}
              />
              <datalist id="peryx-prop-keys">
                {SUGGESTED_KEYS.map((k) => (
                  <option key={k} value={k} />
                ))}
              </datalist>
              <button className="btn-mini" onClick={addProp}>
                添加
              </button>
              <button
                className="btn-mini btn-mini-ghost"
                onClick={() => {
                  setAdding(false);
                  setNewKey("");
                }}
              >
                取消
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

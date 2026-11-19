/** Markdown 快捷工具栏：把常见语法封成按钮，不需要懂 Markdown 也能写笔记 */

import { useEffect, useRef, useState } from "react";
import type { EditorView } from "@codemirror/view";
import {
  toggleWrap,
  toggleLinePrefix,
  setHeading,
  insertLink,
  insertTable,
  insertMath,
  insertCodeBlock,
  insertTaskItem,
  insertHr,
  toggleHighlight,
  toggleInlineCode,
  toggleQuote,
  insertBlock,
} from "@/editor/commands";
import { api } from "@/lib/api";
import { renderKatexHtml } from "@/lib/markdown";
import { useStore } from "@/stores/app";

interface ButtonDef {
  id: string;
  label: string;
  title: string;
  shortcut?: string;
  run: (view: EditorView, ctx: ToolbarContext) => void;
}

interface ToolbarContext {
  openLink: () => void;
  openTable: () => void;
  openMath: () => void;
  openImage: () => void;
  openCode: () => void;
}

interface Props {
  getView: () => EditorView | null;
}

/** 荧光笔图标（高亮） */
function HighlighterIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {/* 笔身 */}
      <path d="M14.5 3.5 20 9l-8.2 8.2a2 2 0 0 1-1.4.6H7.3l-2.6-2.6v-3.1a2 2 0 0 1 .6-1.4z" />
      {/* 笔尖分界 */}
      <path d="M11.5 6.5 17 12" />
      {/* 底部描线（表示涂抹） */}
      <path d="M4 21h13" strokeWidth="2.4" />
    </svg>
  );
}

const groups: { id: string; items: ButtonDef[] }[] = [
  {
    id: "heading",
    items: [
      { id: "h1", label: "H1", title: "一级标题", run: (v) => setHeading(v, 1) },
      { id: "h2", label: "H2", title: "二级标题", run: (v) => setHeading(v, 2) },
      { id: "h3", label: "H3", title: "三级标题", run: (v) => setHeading(v, 3) },
      { id: "h0", label: "正文", title: "清除标题", run: (v) => setHeading(v, 0) },
    ],
  },
  {
    id: "inline",
    items: [
      { id: "bold", label: "B", title: "加粗", shortcut: "Ctrl+B", run: (v) => toggleWrap(v, "**", "粗体") },
      { id: "italic", label: "I", title: "斜体", shortcut: "Ctrl+I", run: (v) => toggleWrap(v, "*", "斜体") },
      { id: "strike", label: "S", title: "删除线", shortcut: "Ctrl+Shift+S", run: (v) => toggleWrap(v, "~~", "删除线") },
      { id: "mark", label: "highlight", title: "高亮", run: (v) => toggleHighlight(v) },
      { id: "code-inline", label: "</>", title: "行内代码", shortcut: "Ctrl+E", run: (v) => toggleInlineCode(v) },
    ],
  },
  {
    id: "block",
    items: [
      { id: "ul", label: "• 列表", title: "无序列表", run: (v) => toggleLinePrefix(v, "- ") },
      { id: "ol", label: "1. 列表", title: "有序列表", run: (v) => toggleLinePrefix(v, "", true) },
      { id: "task", label: "☑ 待办", title: "任务列表", run: (v) => insertTaskItem(v) },
      { id: "quote", label: "❝ 引用", title: "引用块", run: (v) => toggleQuote(v) },
      { id: "hr", label: "—", title: "分割线", run: (v) => insertHr(v) },
    ],
  },
  {
    id: "insert",
    items: [
      { id: "link", label: "🔗", title: "插入链接", shortcut: "Ctrl+K", run: (_v, c) => c.openLink() },
      { id: "image", label: "🖼", title: "插入图片", run: (_v, c) => c.openImage() },
      { id: "table", label: "▦", title: "插入表格", run: (_v, c) => c.openTable() },
      { id: "math", label: "∑", title: "插入数学公式", run: (_v, c) => c.openMath() },
      { id: "code-block", label: "{ }", title: "插入代码块", shortcut: "Ctrl+Shift+K", run: (_v, c) => c.openCode() },
    ],
  },
];

type DialogKind = "link" | "table" | "math" | "code" | "image";

export function Toolbar({ getView }: Props) {
  const [dialog, setDialog] = useState<DialogKind | null>(null);
  /** Hₙ 下拉是否展开 */
  const [headingMenu, setHeadingMenu] = useState(false);

  const ctx: ToolbarContext = {
    openLink: () => setDialog("link"),
    openTable: () => setDialog("table"),
    openMath: () => setDialog("math"),
    openCode: () => setDialog("code"),
    openImage: () => setDialog("image"),
  };

  // 快捷键与工具栏共享命令
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const view = getView();
      if (!view || !view.hasFocus) return;
      const k = e.key.toLowerCase();
      if (k === "b" && !e.shiftKey) {
        e.preventDefault();
        toggleWrap(view, "**", "粗体");
      } else if (k === "i" && !e.shiftKey) {
        e.preventDefault();
        toggleWrap(view, "*", "斜体");
      } else if (k === "s" && e.shiftKey) {
        e.preventDefault();
        toggleWrap(view, "~~", "删除线");
      } else if (k === "e") {
        e.preventDefault();
        toggleInlineCode(view);
      } else if (k === "k" && !e.shiftKey) {
        e.preventDefault();
        setDialog("link");
      } else if (k === "k" && e.shiftKey) {
        e.preventDefault();
        setDialog("code");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [getView]);

  return (
    <>
      <div className="toolbar">
        {groups.map((g, gi) => (
          <div className="toolbar-group" key={g.id}>
            {gi > 0 && <span className="toolbar-sep" />}
            {g.items.map((btn) => (
              <button
                key={btn.id}
                className={`tb-btn tb-${btn.id}`}
                title={btn.shortcut ? `${btn.title} (${btn.shortcut})` : btn.title}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  const view = getView();
                  if (view) btn.run(view, ctx);
                }}
              >
                {btn.id === "mark" ? <HighlighterIcon /> : btn.label}
              </button>
            ))}
            {/* 标题组后面挂一个 Hₙ 下拉，放不常用的 H4–H6 */}
            {g.id === "heading" && (
              <div className="tb-dropdown-wrap">
                <button
                  className="tb-btn tb-hn"
                  title="更多标题级别（H4–H6）"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => setHeadingMenu((v) => !v)}
                >
                  H<sub>n</sub>
                  <span className="tb-caret">▾</span>
                </button>
                {headingMenu && (
                  <div className="ctx-mask" onMouseDown={() => setHeadingMenu(false)}>
                    <div className="tb-dropdown" onMouseDown={(e) => e.stopPropagation()}>
                      {[1, 2, 3, 4, 5, 6].map((lv) => (
                        <button
                          key={lv}
                          className="tb-dropdown-item"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => {
                            setHeadingMenu(false);
                            const view = getView();
                            if (view) setHeading(view, lv);
                          }}
                        >
                          <span className={`tb-heading-sample tb-h${lv}`}>H{lv}</span>
                          <span className="tb-dropdown-desc">{lv} 级标题</span>
                        </button>
                      ))}
                      <div className="ctx-sep" />
                      <button
                        className="tb-dropdown-item"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          setHeadingMenu(false);
                          const view = getView();
                          if (view) setHeading(view, 0);
                        }}
                      >
                        <span className="tb-heading-sample">正文</span>
                        <span className="tb-dropdown-desc">清除标题</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}

        <div className="toolbar-spacer" />
      </div>

      {dialog === "link" && <LinkDialog view={getView()} onClose={() => setDialog(null)} />}
      {dialog === "table" && <TableDialog view={getView()} onClose={() => setDialog(null)} />}
      {dialog === "math" && <MathDialog view={getView()} onClose={() => setDialog(null)} />}
      {dialog === "code" && <CodeDialog view={getView()} onClose={() => setDialog(null)} />}
      {dialog === "image" && <ImageDialog view={getView()} onClose={() => setDialog(null)} />}
    </>
  );
}

// ---------------------------------------------------------------------------
// 通用弹窗
// ---------------------------------------------------------------------------

function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="modal-mask" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-title">{title}</div>
        {children}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 各对话框
// ---------------------------------------------------------------------------

function LinkDialog({ view, onClose }: { view: EditorView | null; onClose: () => void }) {
  const [text, setText] = useState("");
  const [url, setUrl] = useState("https://");
  return (
    <Modal title="插入链接" onClose={onClose}>
      <label className="field">
        <span>显示文字</span>
        <input autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="链接文字" />
      </label>
      <label className="field">
        <span>地址</span>
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" />
      </label>
      <div className="modal-actions">
        <button className="btn-ghost" onClick={onClose}>取消</button>
        <button
          className="btn-primary"
          onClick={() => {
            if (view) insertLink(view, text, url);
            onClose();
          }}
        >
          插入
        </button>
      </div>
    </Modal>
  );
}

function TableDialog({ view, onClose }: { view: EditorView | null; onClose: () => void }) {
  const [rows, setRows] = useState(3);
  const [cols, setCols] = useState(3);
  return (
    <Modal title="插入表格" onClose={onClose}>
      <label className="field">
        <span>行数（含表头）</span>
        <input type="number" min={2} max={20} value={rows} onChange={(e) => setRows(+e.target.value)} />
      </label>
      <label className="field">
        <span>列数</span>
        <input type="number" min={1} max={10} value={cols} onChange={(e) => setCols(+e.target.value)} />
      </label>
      <div className="modal-preview">{Math.max(2, rows)} × {Math.max(1, cols)} 的表格</div>
      <div className="modal-actions">
        <button className="btn-ghost" onClick={onClose}>取消</button>
        <button
          className="btn-primary"
          onClick={() => {
            if (view) insertTable(view, Math.max(2, rows), Math.max(1, cols));
            onClose();
          }}
        >
          插入
        </button>
      </div>
    </Modal>
  );
}

function MathDialog({ view, onClose }: { view: EditorView | null; onClose: () => void }) {
  const [tex, setTex] = useState("E = mc^2");
  const [display, setDisplay] = useState(true);
  let preview = "";
  try {
    preview = renderKatexHtml(tex, display);
  } catch {
    preview = "公式语法有误";
  }
  return (
    <Modal title="插入数学公式（LaTeX）" onClose={onClose}>
      <label className="field">
        <span>公式内容</span>
        <textarea
          autoFocus
          rows={3}
          value={tex}
          onChange={(e) => setTex(e.target.value)}
          placeholder="\int_0^1 x^2 dx"
          style={{ fontFamily: "var(--font-mono)" }}
        />
      </label>
      <label className="field-row">
        <input type="checkbox" checked={display} onChange={(e) => setDisplay(e.target.checked)} />
        <span>独立成行（块级公式）</span>
      </label>
      <div className="modal-preview" dangerouslySetInnerHTML={{ __html: preview }} />
      <div className="modal-hint">
        常用：\frac&#123;a&#125;&#123;b&#125; 分数 · \sqrt&#123;x&#125; 根号 · ^{} 上标 · _&#123;&#125; 下标 · \sum 求和 · \int 积分
      </div>
      <div className="modal-actions">
        <button className="btn-ghost" onClick={onClose}>取消</button>
        <button
          className="btn-primary"
          onClick={() => {
            if (view) insertMath(view, display, tex);
            onClose();
          }}
        >
          插入
        </button>
      </div>
    </Modal>
  );
}

function CodeDialog({ view, onClose }: { view: EditorView | null; onClose: () => void }) {
  const [lang, setLang] = useState("");
  const langs = [
    "", "javascript", "typescript", "python", "java", "c", "cpp", "csharp",
    "rust", "go", "sql", "bash", "powershell", "json", "yaml", "html", "css",
    "markdown", "matlab", "latex",
  ];
  return (
    <Modal title="插入代码块" onClose={onClose}>
      <label className="field">
        <span>语言（用于语法高亮）</span>
        <select value={lang} onChange={(e) => setLang(e.target.value)}>
          {langs.map((l) => (
            <option key={l || "none"} value={l}>
              {l || "纯文本"}
            </option>
          ))}
        </select>
      </label>
      <div className="modal-actions">
        <button className="btn-ghost" onClick={onClose}>取消</button>
        <button
          className="btn-primary"
          onClick={() => {
            if (view) insertCodeBlock(view, lang);
            onClose();
          }}
        >
          插入
        </button>
      </div>
    </Modal>
  );
}

function ImageDialog({ view, onClose }: { view: EditorView | null; onClose: () => void }) {
  const [src, setSrc] = useState("");
  const [alt, setAlt] = useState("");
  const [busy, setBusy] = useState(false);
  const toast = useStore((s) => s.toast);
  const inputRef = useRef<HTMLInputElement>(null);

  const pick = async () => {
    const file = inputRef.current?.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      const buf = new Uint8Array(await file.arrayBuffer());
      const rel = await api.saveAttachment(file.name, Array.from(buf));
      setSrc(rel);
      if (!alt) setAlt(file.name.replace(/\.[^.]+$/, ""));
    } catch (e) {
      toast(String(e), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="插入图片" onClose={onClose}>
      <label className="field">
        <span>选择本地图片（会复制到笔记库 assets/ 目录）</span>
        <input ref={inputRef} type="file" accept="image/*" onChange={pick} />
      </label>
      {busy && <div className="modal-preview">正在复制…</div>}
      <label className="field">
        <span>图片描述（alt）</span>
        <input value={alt} onChange={(e) => setAlt(e.target.value)} placeholder="图片说明" />
      </label>
      <label className="field">
        <span>或直接填写路径 / URL</span>
        <input value={src} onChange={(e) => setSrc(e.target.value)} placeholder="assets/image.png" />
      </label>
      <div className="modal-actions">
        <button className="btn-ghost" onClick={onClose}>取消</button>
        <button
          className="btn-primary"
          disabled={!src}
          onClick={() => {
            if (view && src) insertBlock(view, `![${alt || "图片"}](${src})`);
            onClose();
          }}
        >
          插入
        </button>
      </div>
    </Modal>
  );
}
/** CodeMirror 6 编辑器主题（浅色为主，与 Peryx 配色一致） */

import { EditorView } from "@codemirror/view";

export const peryxTheme = EditorView.theme({
  "&": {
    height: "100%",
    fontSize: "16px",
    backgroundColor: "var(--bg-editor)",
    color: "var(--fg)",
  },
  ".cm-scroller": {
    fontFamily: "var(--font-mono)",
    lineHeight: "1.75",
    overflow: "auto",
    padding: "12px 0 40vh 0",
  },
  ".cm-content": {
    padding: "0",
    maxWidth: "820px",
    margin: "0 auto",
    width: "100%",
    caretColor: "var(--accent)",
  },
  ".cm-line": {
    padding: "0 24px",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--accent)", borderLeftWidth: "2px" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
    backgroundColor: "var(--selection) !important",
  },
  ".cm-activeLine": { backgroundColor: "var(--active-line)" },
  ".cm-gutters": {
    backgroundColor: "var(--bg-editor)",
    color: "var(--fg-faint)",
    border: "none",
    paddingRight: "4px",
  },
  ".cm-activeLineGutter": { backgroundColor: "var(--active-line)", color: "var(--fg-muted)" },

  // ---- 实时渲染样式 ----
  ".cm-h1": { fontSize: "1.9em", fontWeight: "700", lineHeight: "1.35" },
  ".cm-h2": { fontSize: "1.55em", fontWeight: "700", lineHeight: "1.4" },
  ".cm-h3": { fontSize: "1.3em", fontWeight: "600", lineHeight: "1.45" },
  ".cm-h4": { fontSize: "1.15em", fontWeight: "600" },
  ".cm-h5": { fontSize: "1.05em", fontWeight: "600" },
  ".cm-h6": { fontSize: "1em", fontWeight: "600", color: "var(--fg-muted)" },

  /**
   * Markdown 标记符号：视觉上完全消失，但字符保留在 DOM 里。
   *
   * 实测验证：CodeMirror 的点击定位**不依赖字符实际渲染宽度**，
   * 把标记压成 0 宽后，点击依然精确到行。
   */
  ".cm-mark-hidden": {
    fontSize: "0 !important",
    lineHeight: "0 !important",
    opacity: "0 !important",
    display: "inline-block",
    width: "0 !important",
    overflow: "hidden !important",
    verticalAlign: "baseline",
    userSelect: "none",
    pointerEvents: "none",
  },

  /**
   * 光标所在行的标记：可见但弱化，提示「这里可以编辑语法」。
   */
  ".cm-mark-visible": {
    color: "var(--fg-faint)",
    opacity: "0.75",
    fontFamily: "var(--font-mono)",
  },

  ".cm-ordered-num": {
    color: "var(--accent)",
    fontWeight: "600",
    marginRight: "0.15em",
  },

  ".cm-strong": { fontWeight: "700" },
  ".cm-em": { fontStyle: "italic" },
  ".cm-strike": { textDecoration: "line-through", opacity: "0.55" },
  ".cm-highlight": {
    backgroundColor: "rgba(255, 213, 79, 0.45)",
    borderRadius: "3px",
    padding: "0.05em 0.1em",
    margin: "0 -0.1em",
  },
  ".cm-inline-code": {
    fontFamily: "var(--font-mono)",
    backgroundColor: "var(--code-bg)",
    color: "var(--code-fg)",
    borderRadius: "4px",
    padding: "0.1em 0.3em",
    fontSize: "0.92em",
  },
  ".cm-link-text": {
    color: "var(--accent)",
    textDecoration: "underline",
    textUnderlineOffset: "2px",
  },
  ".cm-math-text": {
    fontFamily: "var(--font-serif)",
    color: "var(--accent-ink)",
    fontStyle: "italic",
  },

  // 公式渲染预览（独立插入的行块，不替换源码，不影响点击）
  ".cm-formula-preview": {
    textAlign: "center",
    padding: "6px 0 10px",
    overflowX: "auto",
    borderBottom: "1px dashed var(--border)",
    marginBottom: "4px",
    pointerEvents: "none",
    userSelect: "none",
  },

  // 行内公式渲染结果（光标不在该行时显示）
  ".cm-inline-math": {
    display: "inline-block",
    verticalAlign: "baseline",
    padding: "0 1px",
    cursor: "text",
  },

  // 编辑行内公式时，下方显示的渲染预览
  ".cm-inline-math-preview": {
    display: "flex",
    flexWrap: "wrap",
    gap: "14px",
    alignItems: "center",
    margin: "2px 0 6px 24px",
    padding: "4px 10px",
    borderLeft: "2px solid var(--accent)",
    backgroundColor: "rgba(47, 111, 107, 0.045)",
    borderRadius: "0 4px 4px 0",
    fontSize: "0.94em",
    pointerEvents: "none",
    userSelect: "none",
  },
  ".cm-inline-math-preview-item": {
    display: "inline-block",
  },

  // 整块渲染的表格
  ".cm-table-widget": {
    padding: "6px 24px",
    overflowX: "auto",
  },
  ".cm-table-element": {
    borderCollapse: "collapse",
    fontSize: "0.94em",
    minWidth: "60%",
    backgroundColor: "var(--bg-elevated)",
    border: "1px solid var(--border-strong)",
    borderRadius: "6px",
  },
  ".cm-table-element th": {
    backgroundColor: "var(--bg-panel)",
    fontWeight: "700",
    color: "var(--accent-ink)",
    textAlign: "left",
    padding: "7px 14px",
    borderBottom: "1.5px solid var(--border-strong)",
    borderRight: "1px solid var(--border)",
    whiteSpace: "nowrap",
  },
  ".cm-table-element td": {
    padding: "6px 14px",
    borderBottom: "1px solid var(--border)",
    borderRight: "1px solid var(--border)",
  },
  // 可编辑单元格
  ".cm-table-element th[contenteditable], .cm-table-element td[contenteditable]": {
    outline: "none",
    cursor: "text",
    minWidth: "48px",
    transition: "background 0.12s",
  },
  ".cm-table-element th[contenteditable]:hover, .cm-table-element td[contenteditable]:hover":
    {
      backgroundColor: "rgba(47, 111, 107, 0.07)",
    },
  ".cm-table-element th[contenteditable]:focus, .cm-table-element td[contenteditable]:focus":
    {
      backgroundColor: "rgba(47, 111, 107, 0.1)",
      boxShadow: "inset 0 0 0 2px var(--accent)",
    },
  ".cm-table-element th:last-child, .cm-table-element td:last-child": {
    borderRight: "none",
  },
  ".cm-table-element tbody tr:last-child td": {
    borderBottom: "none",
  },
  ".cm-table-element tbody tr:hover": {
    backgroundColor: "rgba(47, 111, 107, 0.04)",
  },

  // 表格编辑态的源码行
  ".cm-table-source": {
    fontFamily: "var(--font-mono)",
    fontSize: "0.88em",
    backgroundColor: "var(--code-bg)",
  },

  // 水平分割线
  ".cm-hr-widget": {
    padding: "10px 24px",
  },
  ".cm-hr-widget hr": {
    border: "none",
    borderTop: "1.5px solid var(--border-strong)",
    margin: "0",
  },

  // 块级结构
  ".cm-quote": {
    borderLeft: "3px solid var(--quote-border)",
    color: "var(--fg-muted)",
    fontStyle: "italic",
  },
  ".cm-code-line": {
    backgroundColor: "var(--code-bg)",
    fontFamily: "var(--font-mono)",
    fontSize: "0.92em",
  },
  ".cm-code-fence": {
    fontFamily: "var(--font-mono)",
    fontSize: "0.72em",
    opacity: "0.35",
    backgroundColor: "var(--code-bg)",
  },
  /**
   * 块级公式的源码行（`$$...$$`）。
   * 下方已有 KaTeX 渲染结果，这里把源码行本身收得很窄很淡，
   * 仅在需要编辑时才会变清楚（光标进入）。
   */
  ".cm-math-source-line": {
    fontFamily: "var(--font-mono)",
    fontSize: "0.62em",
    lineHeight: "1.25",
    opacity: "0.28",
    backgroundColor: "transparent",
    color: "var(--fg-faint)",
  },
  ".cm-table-line": {
    fontFamily: "var(--font-ui)",
    fontSize: "0.95em",
    backgroundColor: "var(--bg-elevated)",
    borderLeft: "1px solid var(--border-strong)",
    borderRight: "1px solid var(--border-strong)",
    padding: "0.32em 0.75em",
    letterSpacing: "0.02em",
  },
  // 表头行：加粗 + 浅色底
  ".cm-table-head": {
    fontWeight: "700",
    color: "var(--accent-ink)",
    backgroundColor: "var(--bg-panel)",
    borderTop: "1px solid var(--border-strong)",
  },
  // 单元格之间的竖分隔线
  ".cm-table-divider": {
    display: "inline-block",
    width: "1px",
    height: "1.1em",
    margin: "0 0.7em",
    verticalAlign: "-0.2em",
    backgroundColor: "var(--border-strong)",
  },
  // 表格首尾竖线：不显示
  ".cm-table-edge": {
    display: "inline-block",
    width: "0",
  },
  // 表格分隔行整行隐藏（`|---|---|`）
  ".cm-table-sep": {
    fontSize: "0 !important",
    lineHeight: "0 !important",
    height: "0 !important",
    padding: "0 !important",
    margin: "0 !important",
    overflow: "hidden",
    border: "none !important",
  },
  // 任务列表：整行加复选框
  ".cm-task-line": {
    listStyle: "none",
  },
  // 任务复选框（由 widget 插入，可点击切换）
  ".cm-task-checkbox": {
    display: "inline-block",
    width: "15px",
    height: "15px",
    marginRight: "8px",
    verticalAlign: "-2px",
    cursor: "pointer",
    accentColor: "var(--accent)",
  },
  // 普通无序列表：圆点
  ".cm-list-line::before": {
    content: "'•'",
    display: "inline-block",
    width: "14px",
    marginRight: "6px",
    color: "var(--accent)",
    fontWeight: "700",
  },
  // 已完成任务项的内容
  ".cm-task-done-content": {
    color: "var(--fg-faint)",
    textDecoration: "line-through",
  },
  // 分割线：整行渲染为一条横线
  ".cm-hr-line": {
    position: "relative",
    color: "transparent",
    letterSpacing: "-0.5em",
  },
});

/** Markdown 源码模式下的语法高亮（较淡，不抢视觉） */
export const sourceHighlight = EditorView.theme({
  ".cm-content .tok-heading": { fontWeight: "600", color: "var(--syntax-heading)" },
  ".cm-content .tok-strong": { fontWeight: "700" },
  ".cm-content .tok-emphasis": { fontStyle: "italic" },
  ".cm-content .tok-link": { color: "var(--accent)" },
  ".cm-content .tok-url": { color: "var(--accent)" },
  ".cm-content .tok-monospace": {
    backgroundColor: "var(--code-bg)",
    color: "var(--code-fg)",
    borderRadius: "4px",
  },
  ".cm-content .tok-string": { color: "var(--syntax-string)" },
  ".cm-content .tok-comment": { color: "var(--fg-faint)", fontStyle: "italic" },
  ".cm-content .tok-keyword": { color: "var(--syntax-keyword)" },
  ".cm-content .tok-number": { color: "var(--syntax-number)" },
});

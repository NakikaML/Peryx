/** Markdown 编辑命令：工具栏按钮与快捷键共用的文本操作层 */

import type { EditorView } from "@codemirror/view";
import type { ChangeSpec, EditorState } from "@codemirror/state";

/** 行内包裹：选中文本两侧加标记；未选中则插入占位符并选中占位符 */
export function toggleWrap(
  view: EditorView,
  mark: string,
  placeholder = "",
  multiline = false,
): void {
  const { state } = view;
  const sel = state.selection.main;
  const doc = state.doc;
  const from = sel.from;
  const to = sel.to;
  const text = doc.sliceString(from, to);

  // 已经包裹则取消
  const before = doc.sliceString(Math.max(0, from - mark.length), from);
  const after = doc.sliceString(to, Math.min(doc.length, to + mark.length));
  if (before === mark && after === mark && to > from) {
    view.dispatch({
      changes: [
        { from: from - mark.length, to: from, insert: "" },
        { from: to, to: to + mark.length, insert: "" },
      ],
      selection: { anchor: from - mark.length, head: to - mark.length },
    });
    view.focus();
    return;
  }

  if (multiline) {
    // 多行：每行前后包裹
    const lines = text.split("\n");
    if (lines.length > 1) {
      const insert = lines.map((l) => `${mark}${l}${mark}`).join("\n");
      view.dispatch({
        changes: { from, to, insert },
        selection: { anchor: from, head: from + insert.length },
      });
      view.focus();
      return;
    }
  }

  if (!text) {
    const ph = placeholder || "文字";
    const insert = `${mark}${ph}${mark}`;
    view.dispatch({
      changes: { from, to, insert },
      selection: { anchor: from + mark.length, head: from + mark.length + ph.length },
    });
    view.focus();
    return;
  }

  const insert = `${mark}${text}${mark}`;
  view.dispatch({
    changes: { from, to, insert },
    selection: { anchor: from, head: from + insert.length },
  });
  view.focus();
}

/** 在选中行首添加/移除行前缀 */
export function toggleLinePrefix(view: EditorView, prefix: string, ordered = false): void {
  const { state } = view;
  const sel = state.selection.main;
  const startLine = state.doc.lineAt(sel.from).number;
  const endLine = state.doc.lineAt(sel.to).number;
  const changes: ChangeSpec[] = [];

  for (let n = startLine; n <= endLine; n++) {
    const line = state.doc.line(n);
    const text = line.text;
    if (ordered) {
      const m = /^(\s*)(\d+)\.\s+/.exec(text);
      if (m) {
        changes.push({ from: line.from, to: line.from + m[0].length, insert: m[1] });
      } else {
        changes.push({ from: line.from, insert: `${line.text.match(/^\s*/)?.[0] ?? ""}1. ` });
      }
    } else {
      const indent = text.match(/^\s*/)?.[0] ?? "";
      if (text.startsWith(indent + prefix)) {
        changes.push({ from: line.from, to: line.from + (indent + prefix).length, insert: indent });
      } else {
        changes.push({ from: line.from + indent.length, insert: prefix });
      }
    }
  }
  view.dispatch({ changes });
  view.focus();
}

/** 把选中行的标题级别设为 level（0 = 去掉标题） */
export function setHeading(view: EditorView, level: number): void {
  const { state } = view;
  const sel = state.selection.main;
  const startLine = state.doc.lineAt(sel.from).number;
  const endLine = state.doc.lineAt(sel.to).number;
  const changes: ChangeSpec[] = [];
  for (let n = startLine; n <= endLine; n++) {
    const line = state.doc.line(n);
    const m = /^(#{1,6})\s+/.exec(line.text);
    const insert = level > 0 ? `${"#".repeat(level)} ` : "";
    if (m) {
      changes.push({ from: line.from, to: line.from + m[0].length, insert });
    } else if (insert) {
      changes.push({ from: line.from, insert });
    }
  }
  if (changes.length) {
    view.dispatch({ changes });
    view.focus();
  }
}

/** 在当前行下方插入一段文本 */
export function insertBlock(view: EditorView, text: string, cursorOffset?: number): void {
  const { state } = view;
  const sel = state.selection.main;
  const line = state.doc.lineAt(sel.to);
  // 确保后面有空行分隔
  const needsNewline = line.to < state.doc.length;
  const insert = `\n${needsNewline ? "\n" : ""}${text}`;
  const from = line.to;
  view.dispatch({
    changes: { from, insert },
    selection: { anchor: from + (cursorOffset ?? insert.length) },
  });
  view.focus();
}

/** 在光标处插入文本 */
export function insertText(view: EditorView, text: string, selectAll = false): void {
  const sel = view.state.selection.main;
  view.dispatch({
    changes: { from: sel.from, to: sel.to, insert: text },
    selection: selectAll
      ? { anchor: sel.from, head: sel.from + text.length }
      : { anchor: sel.from + text.length },
  });
  view.focus();
}

/** 插入链接：[文本](url) */
export function insertLink(view: EditorView, text: string, url: string): void {
  const { state } = view;
  const sel = state.selection.main;
  const selected = state.doc.sliceString(sel.from, sel.to);
  const label = text || selected || "链接文本";
  const insert = `[${label}](${url})`;
  view.dispatch({
    changes: { from: sel.from, to: sel.to, insert },
    selection: { anchor: sel.from + insert.length },
  });
  view.focus();
}

/** 插入图片：![alt](path) */
export function insertImage(view: EditorView, alt: string, path: string): void {
  const insert = `![${alt}](${path})`;
  insertBlock(view, insert, insert.length);
}

/** 插入表格 */
export function insertTable(
  view: EditorView,
  rows: number,
  cols: number,
  inFirstRowHeader = true,
): void {
  const header = `| ${Array.from({ length: cols }, (_, i) => `列${i + 1}`).join(" | ")} |`;
  const sep = `| ${Array.from({ length: cols }, () => "---").join(" | ")} |`;
  const body = Array.from(
    { length: Math.max(0, rows - 1) },
    () => `| ${Array.from({ length: cols }, () => "     ").join(" | ")} |`,
  );
  const lines = inFirstRowHeader ? [header, sep, ...body] : [header, sep, ...body];
  insertBlock(view, lines.join("\n"));
}

/** 插入公式块 */
export function insertMath(view: EditorView, display: boolean, tex = ""): void {
  if (display) {
    insertBlock(view, `$$\n${tex || "E = mc^2"}\n$$`);
  } else {
    const sel = view.state.selection.main;
    const selected = view.state.doc.sliceString(sel.from, sel.to);
    const body = tex || selected || "x^2";
    const insert = `$${body}$`;
    view.dispatch({
      changes: { from: sel.from, to: sel.to, insert },
      selection: { anchor: sel.from + 1, head: sel.from + 1 + body.length },
    });
    view.focus();
  }
}

/** 插入代码块 */
export function insertCodeBlock(view: EditorView, lang = ""): void {
  const { state } = view;
  const sel = state.selection.main;
  const selected = state.doc.sliceString(sel.from, sel.to);
  const body = selected || "";
  const fence = "```";
  const insert = `${fence}${lang}\n${body}\n${fence}`;
  const from = sel.from;
  const to = sel.to;
  view.dispatch({
    changes: { from, to, insert },
    selection: {
      anchor: from + fence.length + lang.length + 1,
      head: from + fence.length + lang.length + 1 + body.length,
    },
  });
  view.focus();
}

/** 插入任务列表项 */
export function insertTaskItem(view: EditorView): void {
  insertBlock(view, "- [ ] ");
}

/** 插入分割线 */
export function insertHr(view: EditorView): void {
  insertBlock(view, "---");
}

/** 插入引用 */
export function toggleQuote(view: EditorView): void {
  toggleLinePrefix(view, "> ");
}

/** 插入高亮 ==text== */
export function toggleHighlight(view: EditorView): void {
  toggleWrap(view, "==", "高亮文本");
}

/** 插入行内代码 */
export function toggleInlineCode(view: EditorView): void {
  toggleWrap(view, "`", "code");
}

/** 在指定行位置设置光标（大纲跳转用） */
export function gotoLine(view: EditorView, line: number): void {
  const ln = Math.min(Math.max(0, line), view.state.doc.lines - 1);
  const info = view.state.doc.line(ln + 1);
  view.dispatch({
    selection: { anchor: info.from },
    effects: [],
    scrollIntoView: true,
  });
  view.focus();
}

/** 读取当前选中文本（供对话框默认值用） */
export function selectedText(state: EditorState): string {
  const sel = state.selection.main;
  return state.doc.sliceString(sel.from, sel.to);
}

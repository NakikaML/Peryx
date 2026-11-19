/**
 * 实时渲染（Live Preview）—— 第四版：全局「光标行展开」机制
 *
 * ## 核心规则（与 Obsidian 一致）
 *
 *   **光标所在的「行」，该行的 Markdown 语法完整展开，方便编辑。**
 *   其他行：标记全部隐藏，呈现渲染后的样子。
 *
 * 这条规则统一处理了：
 *   - 标题：光标在标题行 → 显示 `### `；否则隐藏
 *   - 粗体/斜体/删除线/高亮：光标在行内 → 显示 `**` `~~` `==`；否则隐藏
 *   - 引用：光标在行内 → 显示 `> `；否则隐藏
 *   - 链接：光标在行内 → 显示 `[]()`；否则只显示文字
 *   - 行内公式：光标在行内 → 显示 `$...$`；否则渲染为数学符号
 *   - 块级公式：光标在公式块内 → 显示 `$$...$$` 且隐藏渲染预览；否则显示预览
 *
 * ## 为什么这样不会错位
 *
 * 已实测：CodeMirror 的点击定位不依赖字符实际渲染宽度。
 * 标记用 CSS 压成 0 宽（`.cm-mark-hidden`）不会影响点击精度，
 * 而「光标行展开」只是切换 class，同样不影响。
 */

import { syntaxTree } from "@codemirror/language";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import type { DecorationSet } from "@codemirror/view";
import { RangeSetBuilder, StateEffect, StateField } from "@codemirror/state";
import type { EditorState, Extension, Transaction } from "@codemirror/state";
import { renderKatexHtml, renderInline } from "@/lib/markdown";
import { linkTargetExists, resolveLinkTarget } from "@/lib/linkCache";

/** 开关实时渲染（源码模式时置为 false） */
export const setLivePreview = StateEffect.define<boolean>();

export const livePreviewEnabled = StateField.define<boolean>({
  create: () => true,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setLivePreview)) return e.value;
    return value;
  },
});

// ---------------------------------------------------------------------------
// Widgets
// ---------------------------------------------------------------------------

/** 块级公式渲染预览（插入在源码块下方） */
class FormulaPreview extends WidgetType {
  constructor(readonly tex: string) {
    super();
  }
  eq(other: FormulaPreview): boolean {
    return other.tex === this.tex;
  }
  toDOM(): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "cm-formula-preview";
    wrap.innerHTML = renderKatexHtml(this.tex, true);
    wrap.setAttribute("aria-hidden", "true");
    return wrap;
  }
  ignoreEvent(): boolean {
    return false;
  }
}

// ---------------------------------------------------------------------------
// 任务复选框
// ---------------------------------------------------------------------------

/**
 * 任务列表复选框的交互。
 *
 * 为什么不用 widget 内部的 addEventListener：
 * CodeMirror 会在 widget 外层包 `cm-widgetBuffer` 并接管鼠标事件，
 * widget 内部的监听器可能收不到。官方推荐用 `EditorView.domEventHandlers`
 * 在编辑器层面统一捕获。
 *
 * 实现：把 checkbox 的「文档区间」记在 DOM 元素上，点击时读取并 dispatch。
 */
const taskCheckboxHandler = EditorView.domEventHandlers({
  mousedown(event, view) {
    const target = event.target as HTMLElement | null;
    if (!target || !target.classList?.contains("cm-task-checkbox")) return false;
    const from = Number(target.dataset.taskFrom);
    const to = Number(target.dataset.taskTo);
    const checked = target.dataset.taskChecked === "1";
    if (!Number.isFinite(from) || !Number.isFinite(to)) return false;

    event.preventDefault();
    event.stopPropagation();
    view.dispatch({
      changes: { from, to, insert: checked ? "[ ]" : "[x]" },
    });
    return true;
  },
});

/** 解析一行 Markdown 表格为单元格数组 */
function parseTableRow(text: string): string[] {
  let t = text.trim();
  if (t.startsWith("|")) t = t.slice(1);
  if (t.endsWith("|")) t = t.slice(0, -1);
  return t.split("|").map((c) => c.trim());
}

/** 判断是否为表格分隔行（`|---|---|`） */
function isTableSeparator(cells: string[]): boolean {
  return cells.length > 0 && cells.every((c) => /^:?-{1,}:?$/.test(c.trim()));
}

/** 用户刚点击、但还没拿到焦点的单元格（跨 widget 重建保留） */
let pendingFocusCell: { row: number; col: number } | null = null;

/** 尝试把焦点还给 pendingFocusCell 指向的单元格 */
function focusPendingCell(): void {
  const target = pendingFocusCell;
  pendingFocusCell = null;
  if (!target) return;
  // widget 可能刚重建，等一帧再找
  requestAnimationFrame(() => {
    const el = document.querySelector<HTMLElement>(
      `.cm-table-element [data-row="${target.row}"][data-col="${target.col}"]`,
    );
    if (el) el.focus();
  });
}

/**
 * 单元格数组 → Markdown 表格源码。
 * `rows` 中包含分隔行时原样保留，否则自动生成一行 `---`。
 */
function rowsToMarkdown(rows: string[][]): string {
  if (rows.length === 0) return "";
  const cols = Math.max(...rows.map((r) => r.length));
  const pad = (r: string[]) => {
    const copy = r.slice();
    while (copy.length < cols) copy.push("");
    return copy;
  };
  const fmt = (r: string[]) => `| ${pad(r).join(" | ")} |`;
  const hasSep = rows.length > 1 && isTableSeparator(rows[1]);
  const out: string[] = [fmt(rows[0])];
  out.push(hasSep ? fmt(rows[1]) : fmt(rows[0].map(() => "---")));
  for (let i = hasSep ? 2 : 1; i < rows.length; i++) out.push(fmt(rows[i]));
  return out.join("\n");
}

/**
 * 整块表格渲染 —— Obsidian 风格：表格始终渲染，点击单元格直接编辑。
 *
 * 工作方式：
 *  - 用 `<table>` 渲染，单元格 `contenteditable`
 *  - 未聚焦时单元格显示渲染结果（公式/粗体）
 *  - 聚焦时切换为「原始 Markdown 文本」，方便输入
 *  - 失焦（或按 Enter）时把内容写回 Markdown 并提交
 *  - 提交后文档变化 → widget 重建 → 显示新内容
 */
class TableWidget extends WidgetType {
  constructor(
    readonly rows: string[][],
    readonly from: number,
    readonly to: number,
  ) {
    super();
  }
  eq(other: TableWidget): boolean {
    return (
      JSON.stringify(other.rows) === JSON.stringify(this.rows) &&
      other.from === this.from &&
      other.to === this.to
    );
  }
  toDOM(view: EditorView): HTMLElement {
    const hasSep = this.rows.length > 1 && isTableSeparator(this.rows[1]);
    // 显示用的行（去掉分隔行），同时记录它们在原始 rows 中的下标
    const displayRows: { cells: string[]; rowIndex: number }[] = [];
    this.rows.forEach((cells, i) => {
      if (isTableSeparator(cells)) return;
      displayRows.push({ cells, rowIndex: i });
    });

    const wrap = document.createElement("div");
    wrap.className = "cm-table-widget";
    if (displayRows.length === 0) return wrap;

    const table = document.createElement("table");
    table.className = "cm-table-element";

    /** 提交单个单元格的修改 */
    const commitCell = (rowIndex: number, colIndex: number, value: string) => {
      const rows = this.rows.map((r) => r.slice());
      if (!rows[rowIndex]) return;
      const old = (rows[rowIndex][colIndex] ?? "").trim();
      const next = value.replace(/\s+/g, " ").trim();
      if (old === next) return;
      // 补齐列数
      while (rows[rowIndex].length <= colIndex) rows[rowIndex].push("");
      rows[rowIndex][colIndex] = next;
      const markdown = rowsToMarkdown(rows);
      view.dispatch({
        changes: { from: this.from, to: this.to, insert: markdown },
      });
    };

    /** 创建一个可编辑单元格 */
    const makeCell = (
      tag: "th" | "td",
      raw: string,
      rowIndex: number,
      colIndex: number,
    ): HTMLElement => {
      const el = document.createElement(tag);
      el.contentEditable = "true";
      el.spellcheck = false;
      el.dataset.raw = raw;
      el.dataset.row = String(rowIndex);
      el.dataset.col = String(colIndex);
      // 未聚焦时显示渲染结果
      el.innerHTML = renderInline(raw);

      /** 恢复为「渲染态」（把源码文本换回渲染结果） */
      const restoreRendered = (value?: string) => {
        const v = value ?? el.dataset.raw ?? "";
        el.dataset.raw = v;
        el.textContent = "";
        el.innerHTML = renderInline(v);
      };

      // 聚焦：切回原始 Markdown，便于输入
      el.addEventListener("focus", () => {
        if (el.dataset.editing === "1") return;
        el.dataset.editing = "1";
        el.textContent = el.dataset.raw ?? "";
        // 光标移到末尾
        const sel = window.getSelection();
        if (sel) {
          const range = document.createRange();
          range.selectNodeContents(el);
          range.collapse(false);
          sel.removeAllRanges();
          sel.addRange(range);
        }
      });

      // 失焦：提交（无变化时也要恢复渲染态）
      el.addEventListener("blur", () => {
        if (el.dataset.editing !== "1") return;
        el.dataset.editing = "0";
        const next = (el.textContent ?? "").replace(/\s+/g, " ").trim();
        const old = (el.dataset.raw ?? "").trim();

        if (next === old) {
          // 没有改动 → 直接把 DOM 还原成渲染态（不触发文档更新）
          restoreRendered(old);
          return;
        }

        // 有改动 → 立即在本地更新显示，再提交到文档
        restoreRendered(next);
        commitCell(rowIndex, colIndex, next);
        // 提交后 widget 会整体重建，把焦点还给用户刚点击的下一个单元格
        focusPendingCell();
      });

      // 阻止事件冒泡到 CodeMirror，避免它接管按键/点击
      const stop = (e: Event) => e.stopPropagation();
      el.addEventListener("keydown", (e) => {
        e.stopPropagation();
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          el.blur();
        } else if (e.key === "Escape") {
          e.preventDefault();
          el.dataset.editing = "0";
          el.textContent = "";
          el.innerHTML = renderInline(el.dataset.raw ?? "");
          el.blur();
        } else if (e.key === "Tab") {
          e.preventDefault();
          // Tab 在单元格间移动
          const cells = Array.from(
            wrap.querySelectorAll<HTMLElement>("th[contenteditable], td[contenteditable]"),
          );
          const idx = cells.indexOf(el);
          const target = cells[e.shiftKey ? idx - 1 : idx + 1];
          if (target) {
            pendingFocusCell = {
              row: Number(target.dataset.row),
              col: Number(target.dataset.col),
            };
            target.focus();
          }
        }
      });
      // 点击时记录目标单元格：若另一个单元格因提交而触发重建，焦点要能回到这里
      el.addEventListener("mousedown", (e) => {
        e.stopPropagation();
        if (el.dataset.editing !== "1") {
          pendingFocusCell = { row: rowIndex, col: colIndex };
        }
      });
      el.addEventListener("click", stop);
      el.addEventListener("input", stop);
      return el;
    };

    // 表头
    const thead = document.createElement("thead");
    const headRow = document.createElement("tr");
    const header = displayRows[0];
    header.cells.forEach((cell, ci) => {
      headRow.appendChild(makeCell("th", cell, header.rowIndex, ci));
    });
    thead.appendChild(headRow);
    table.appendChild(thead);

    // 表体
    if (displayRows.length > 1) {
      const tbody = document.createElement("tbody");
      for (let i = 1; i < displayRows.length; i++) {
        const { cells, rowIndex } = displayRows[i];
        const tr = document.createElement("tr");
        for (let ci = 0; ci < cells.length; ci++) {
          tr.appendChild(makeCell("td", cells[ci], rowIndex, ci));
        }
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
    }

    wrap.appendChild(table);
    void hasSep;
    return wrap;
  }
  ignoreEvent(): boolean {
    // 让单元格自己处理鼠标事件
    return false;
  }
}

/** 水平分割线 */
class HrWidget extends WidgetType {
  eq(): boolean {
    return true;
  }
  toDOM(): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "cm-hr-widget";
    const hr = document.createElement("hr");
    wrap.appendChild(hr);
    return wrap;
  }
  ignoreEvent(): boolean {
    return false;
  }
}

/** 任务列表的可点击复选框 */
class TaskCheckbox extends WidgetType {
  constructor(
    readonly checked: boolean,
    readonly boxFrom: number,
    readonly boxTo: number,
  ) {
    super();
  }
  eq(other: TaskCheckbox): boolean {
    return (
      other.checked === this.checked &&
      other.boxFrom === this.boxFrom &&
      other.boxTo === this.boxTo
    );
  }
  toDOM(): HTMLElement {
    const input = document.createElement("input");
    input.type = "checkbox";
    input.className = "cm-task-checkbox";
    input.checked = this.checked;
    // 区间信息给 docEventHandlers 使用
    input.dataset.taskFrom = String(this.boxFrom);
    input.dataset.taskTo = String(this.boxTo);
    input.dataset.taskChecked = this.checked ? "1" : "0";
    input.setAttribute("aria-label", this.checked ? "标记为未完成" : "标记为完成");
    return input;
  }
  ignoreEvent(): boolean {
    return false;
  }
}

/**
 * 双链 `[[目标]]` / `[[目标|别名]]` 的渲染结果。
 *
 * 目标存在 → 普通链接样式，点击跳转。
 * 目标不存在 → 「待创建」样式（虚线边框），点击新建并打开。
 *
 * 点击事件由编辑器级的 `wikiLinkHandler` 统一处理（见文件末尾），
 * 因为 CodeMirror 会在 widget 外层包 buffer，局部监听不可靠。
 */
class WikiLinkWidget extends WidgetType {
  constructor(
    readonly target: string,
    readonly alias: string | null,
    readonly from: number,
    readonly to: number,
  ) {
    super();
  }
  eq(other: WikiLinkWidget): boolean {
    return (
      other.target === this.target &&
      other.alias === this.alias &&
      other.from === this.from &&
      // 目标是否存在会影响样式，缓存刷新后需要重建
      linkTargetExists(other.target) === linkTargetExists(this.target)
    );
  }
  toDOM(): HTMLElement {
    const exists = linkTargetExists(this.target);
    const el = document.createElement("span");
    el.className = exists ? "cm-wikilink" : "cm-wikilink cm-wikilink-missing";
    el.textContent = this.alias ?? this.target;
    el.dataset.wikiTarget = this.target;
    el.dataset.wikiFrom = String(this.from);
    el.dataset.wikiTo = String(this.to);
    el.title = exists
      ? `跳转到「${this.target}」`
      : `「${this.target}」还不存在，点击创建`;
    return el;
  }
  ignoreEvent(): boolean {
    // 交给编辑器级 handler，否则 CodeMirror 会把点击当光标定位
    return false;
  }
}

/** 行内公式渲染结果 */
class InlineMathWidget extends WidgetType {
  constructor(readonly tex: string) {
    super();
  }
  eq(other: InlineMathWidget): boolean {
    return other.tex === this.tex;
  }
  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-inline-math";
    span.innerHTML = renderKatexHtml(this.tex, false);
    return span;
  }
  ignoreEvent(): boolean {
    return false;
  }
}

// ---------------------------------------------------------------------------
// 装饰实例
// ---------------------------------------------------------------------------

const headingDeco = [1, 2, 3, 4, 5, 6].map((l) => Decoration.line({ class: `cm-h${l}` }));
const quoteDeco = Decoration.line({ class: "cm-quote" });
const codeLineDeco = Decoration.line({ class: "cm-code-line" });
const fenceLineDeco = Decoration.line({ class: "cm-code-fence" });
const taskLineDeco = Decoration.line({ class: "cm-task-line" });
const taskDoneDeco = Decoration.line({ class: "cm-task-line cm-task-done" });
const listLineDeco = Decoration.line({ class: "cm-list-line" });
const mathSourceDeco = Decoration.line({ class: "cm-math-source-line" });

/** 标记隐藏（0 宽透明，字符仍在 DOM 中） */
const markHidden = Decoration.mark({ class: "cm-mark-hidden" });
/** 标记可见（光标所在行时使用，仅轻微淡化以示区分） */
const markVisible = Decoration.mark({ class: "cm-mark-visible" });

const strongDeco = Decoration.mark({ class: "cm-strong" });
const emDeco = Decoration.mark({ class: "cm-em" });
const strikeDeco = Decoration.mark({ class: "cm-strike" });
const highlightDeco = Decoration.mark({ class: "cm-highlight" });
const inlineCodeDeco = Decoration.mark({ class: "cm-inline-code" });
const inlineCodeActiveDeco = Decoration.mark({ class: "cm-inline-code cm-inline-code-active" });
const linkTextDeco = Decoration.mark({ class: "cm-link-text" });
const mathDeco = Decoration.mark({ class: "cm-math-text" });
/** 双链源码（光标在本行时显示 `[[目标]]` 原文） */
const wikiSourceDeco = Decoration.mark({ class: "cm-wikilink-source" });
/** `#标签` 样式 */
const tagDeco = Decoration.mark({ class: "cm-tag" });
const doneContentDeco = Decoration.mark({ class: "cm-task-done-content" });

interface Pending {
  from: number;
  to: number;
  deco: Decoration;
}

// ---------------------------------------------------------------------------
// 构建装饰
// ---------------------------------------------------------------------------

function buildDecorations(state: EditorState): DecorationSet {
  if (!state.field(livePreviewEnabled, false)) return Decoration.none;

  const doc = state.doc;
  const pending: Pending[] = [];

  /**
   * 代码块行号集合（含围栏行）。
   * 双链、行内公式都跳过这些行，避免把代码里的 `[[x]]`、`$a$` 当语法。
   */
  const inFenceLines = new Set<number>();
  {
    let fenceChar: string | null = null;
    for (let n = 1; n <= doc.lines; n++) {
      const t = doc.line(n).text.trimStart();
      const m = /^(`{3,}|~{3,})/.exec(t);
      if (m) {
        const ch = m[1][0];
        if (fenceChar === null) {
          fenceChar = ch;
          inFenceLines.add(n);
          continue;
        } else if (fenceChar === ch) {
          fenceChar = null;
          inFenceLines.add(n);
          continue;
        }
      }
      if (fenceChar !== null) inFenceLines.add(n);
    }
  }

  const pushLine = (from: number, deco: Decoration) => pending.push({ from, to: from, deco });
  const mark = (from: number, to: number, deco: Decoration) => {
    if (to > from) pending.push({ from, to, deco });
  };

  /** 判断某位置所在行是否有光标（决定是否展开源码） */
  const isActivePos = (pos: number): boolean => {
    const lineNo = doc.lineAt(pos).number;
    for (const r of state.selection.ranges) {
      const a = doc.lineAt(r.from).number;
      const b = doc.lineAt(r.to).number;
      if (lineNo >= a && lineNo <= b) return true;
    }
    return false;
  };

  /** 根据激活状态返回该用的标记装饰 */
  const markDeco = (active: boolean) => (active ? markVisible : markHidden);

  // ---- 1. 逐行块级结构 ----
  let inFence = false;
  let fenceChar = "";

  for (let n = 1; n <= doc.lines; n++) {
    const line = doc.line(n);
    const text = line.text;
    const trimmed = text.trimStart();
    const active = isActivePos(line.from);

    // 代码围栏
    const fence = /^(`{3,}|~{3,})/.exec(trimmed);
    if (fence) {
      if (!inFence) {
        inFence = true;
        fenceChar = fence[1][0];
        pushLine(line.from, fenceLineDeco);
      } else if (fenceChar === fence[1][0]) {
        inFence = false;
        pushLine(line.from, fenceLineDeco);
      }
      continue;
    }
    if (inFence) {
      pushLine(line.from, codeLineDeco);
      continue;
    }

    // 标题
    const h = /^(#{1,6})(\s+)/.exec(text);
    if (h) {
      pushLine(line.from, headingDeco[h[1].length - 1]);
      mark(line.from, line.from + h[0].length, markDeco(active));
      continue;
    }

    // 分割线：非激活时整行替换为 <hr>
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(text)) {
      if (active) {
        pushLine(line.from, fenceLineDeco);
      } else {
        pending.push({
          from: line.from,
          to: line.to,
          deco: Decoration.replace({
            widget: new HrWidget(),
            block: true,
          }),
        });
      }
      continue;
    }

    // 引用
    if (/^\s*>/.test(text)) {
      pushLine(line.from, quoteDeco);
      const m = /^(\s*>\s?)/.exec(text);
      if (m) mark(line.from, line.from + m[0].length, markDeco(active));
      continue;
    }

    // 表格：整块渲染，始终显示（Obsidian 风格，点单元格就地编辑）
    if (/^\s*\|/.test(text)) {
      // 收集连续的表格行
      const tableLines: { line: typeof line; index: number }[] = [];
      let endIdx = n;
      for (let k = n; k <= doc.lines; k++) {
        const l = doc.line(k);
        if (/^\s*\|/.test(l.text)) {
          tableLines.push({ line: l, index: k });
          endIdx = k;
        } else {
          break;
        }
      }

      const from = tableLines[0].line.from;
      const lastLine = tableLines[tableLines.length - 1].line;
      const to = lastLine.to;
      const rows = tableLines.map((t) => parseTableRow(t.line.text));
      pending.push({
        from,
        to,
        deco: Decoration.replace({
          widget: new TableWidget(rows, from, to),
          block: true,
        }),
      });

      n = endIdx; // 跳过已处理的表格行
      continue;
    }

    // 任务列表
    const task = /^(\s*[-*+]\s+)\[([ xX])\]\s+/.exec(text);
    if (task) {
      const done = task[2].toLowerCase() === "x";
      pushLine(line.from, done ? taskDoneDeco : taskLineDeco);
      const listMarkLen = task[1].length;
      const boxFrom = line.from + listMarkLen;
      const boxTo = boxFrom + 3; // `[ ]` 或 `[x]`

      if (active) {
        // 光标在本行：显示原始 `- [x] ` 源码
        mark(line.from, line.from + task[0].length, markVisible);
      } else {
        // 非激活：复选框 widget 替换掉 `[x]` 这 3 个字符
        pending.push({
          from: boxFrom,
          to: boxTo,
          deco: Decoration.replace({
            widget: new TaskCheckbox(done, boxFrom, boxTo),
          }),
        });
        // 列表前缀 `- ` 隐藏
        mark(line.from, boxFrom, markHidden);
        // 复选框后面的空格保留一个
      }
      if (done) {
        const contentFrom = line.from + task[0].length;
        if (contentFrom < line.to) mark(contentFrom, line.to, doneContentDeco);
      }
      continue;
    }

    // 无序列表
    const list = /^(\s*)([-*+])\s+/.exec(text);
    if (list) {
      pushLine(line.from, listLineDeco);
      mark(line.from, line.from + list[0].length, markDeco(active));
      continue;
    }

    // 有序列表：标记直接显示（数字本身有意义），只淡化
    const ol = /^(\s*)(\d+\.)\s+/.exec(text);
    if (ol) {
      pushLine(line.from, listLineDeco);
      mark(line.from, line.from + ol[0].length, decorativeTextDeco);
      continue;
    }
  }

  // ---- 2. 块级公式 $$...$$ ----
  {
    let inFormula = false;
    let formulaLines: string[] = [];
    let blockActive = false;

    for (let n = 1; n <= doc.lines; n++) {
      const line = doc.line(n);
      const text = line.text;
      if (/^\s*(`{3,}|~{3,})/.test(text)) continue;
      const trimmed = text.trim();

      if (!inFormula && trimmed.startsWith("$$")) {
        const rest = trimmed.slice(2);
        const close = rest.lastIndexOf("$$");
        if (close >= 0) {
          const tex = rest.slice(0, close).trim();
          const active = isActivePos(line.from);
          pushLine(line.from, active ? fenceLineDeco : mathSourceDeco);
          // 无论是否编辑，都保留下方渲染
          if (tex) {
            pending.push({
              from: line.to,
              to: line.to,
              deco: Decoration.widget({ widget: new FormulaPreview(tex), block: true, side: 1 }),
            });
          }
        } else {
          inFormula = true;
          formulaLines = [rest];
          blockActive = isActivePos(line.from);
          pushLine(line.from, blockActive ? fenceLineDeco : mathSourceDeco);
        }
        continue;
      }
      if (inFormula) {
        blockActive = blockActive || isActivePos(line.from);
        pushLine(line.from, blockActive ? codeLineDeco : mathSourceDeco);
        const close = text.indexOf("$$");
        if (close >= 0) {
          formulaLines.push(text.slice(0, close));
          const tex = formulaLines.join("\n").trim();
          // 无论是否在编辑，都保留下方渲染预览
          if (tex) {
            pending.push({
              from: line.to,
              to: line.to,
              deco: Decoration.widget({ widget: new FormulaPreview(tex), block: true, side: 1 }),
            });
          }
          inFormula = false;
          formulaLines = [];
          blockActive = false;
        } else {
          formulaLines.push(text);
        }
      }
    }
  }

  // ---- 3. 行内标记（语法树）----
  // 注意：这里**按每个节点的起始行**判断是否激活，
  // 这样光标在 `**加粗**` 内部时，`**` 会显示出来。
  const tree = syntaxTree(state);
  tree.iterate({
    enter: (node) => {
      const name = node.name;
      const from = node.from;
      const to = node.to;
      if (from >= to) return;
      const active = isActivePos(from);
      const md = markDeco(active);

      switch (name) {
        case "StrongEmphasis":
        case "Emphasis":
        case "Strikethrough": {
          const raw = doc.sliceString(from, to);
          let markLen = 1;
          if (raw.startsWith("**") || raw.startsWith("__") || raw.startsWith("~~")) markLen = 2;
          const cFrom = from + markLen;
          const cTo = to - markLen;
          if (cTo <= cFrom) return;
          const cls =
            name === "StrongEmphasis" ? strongDeco : name === "Emphasis" ? emDeco : strikeDeco;
          mark(from, cFrom, md);
          mark(cFrom, cTo, cls);
          mark(cTo, to, md);
          return;
        }

        case "InlineCode": {
          const raw = doc.sliceString(from, to);
          const ticks = /^`+/.exec(raw)?.[0].length ?? 1;
          if (to - from <= ticks * 2) return;
          mark(from, from + ticks, md);
          mark(from + ticks, to - ticks, active ? inlineCodeActiveDeco : inlineCodeDeco);
          mark(to - ticks, to, md);
          return;
        }

        case "Link": {
          const raw = doc.sliceString(from, to);
          const m = /^\[([^\]]*)\]\(([^)]*)\)/.exec(raw);
          if (!m) return;
          const labelFrom = from + 1;
          const labelTo = from + 1 + m[1].length;
          mark(from, labelFrom, md);
          mark(labelFrom, labelTo, linkTextDeco);
          mark(labelTo, to, md);
          return;
        }

        case "Image": {
          mark(from, to, md);
          return;
        }

        default:
          return;
      }
    },
  });

  // ---- 4. 高亮 ==text== ----
  for (let n = 1; n <= doc.lines; n++) {
    const line = doc.line(n);
    const text = line.text;
    if (/^\s*(`{3,}|~{3,})/.test(text)) continue;
    const active = isActivePos(line.from);
    const md = markDeco(active);
    let i = 0;
    while (i < text.length) {
      const open = text.indexOf("==", i);
      if (open < 0) break;
      const close = text.indexOf("==", open + 2);
      if (close < 0) break;
      if (close > open + 2) {
        mark(line.from + open, line.from + open + 2, md);
        mark(line.from + open + 2, line.from + close, highlightDeco);
        mark(line.from + close, line.from + close + 2, md);
      }
      i = close + 2;
    }
  }

  // ---- 4.5 双链 [[目标]] / [[目标|别名]] ----
  // 放在行内公式之前：`[[a$b$]]` 应整体当链接，而不是把 `$b$` 当公式
  for (let n = 1; n <= doc.lines; n++) {
    const line = doc.line(n);
    const text = line.text;
    // 代码行不解析双链
    if (/^\s*(`{3,}|~{3,})/.test(text)) continue;
    if (inFenceLines.has(n)) continue;
    const active = isActivePos(line.from);

    let i = 0;
    while (i + 1 < text.length) {
      if (text[i] !== "[" || text[i + 1] !== "[") {
        i++;
        continue;
      }
      const close = text.indexOf("]]", i + 2);
      if (close < 0) break;
      const inner = text.slice(i + 2, close);
      // 中间不允许再出现 [[
      if (inner.includes("[[")) {
        i += 2;
        continue;
      }
      const trimmed = inner.trim();
      if (!trimmed) {
        i = close + 2;
        continue;
      }
      const bar = trimmed.indexOf("|");
      const target = (bar >= 0 ? trimmed.slice(0, bar) : trimmed).trim();
      const alias = bar >= 0 ? trimmed.slice(bar + 1).trim() : "";
      if (!target) {
        i = close + 2;
        continue;
      }

      const from = line.from + i;
      const to = line.from + close + 2;
      if (active) {
        // 光标在本行：显示源码，方便改目标名
        mark(from, to, wikiSourceDeco);
      } else {
        pending.push({
          from,
          to,
          deco: Decoration.replace({
            widget: new WikiLinkWidget(target, alias || null, from, to),
          }),
        });
      }
      i = close + 2;
    }
  }

  // ---- 4.6 #标签 ----
  // 只做样式标记（不替换文本），保持可编辑。
  // 跳过代码行与行内代码；`#` 前必须是行首或空白。
  for (let n = 1; n <= doc.lines; n++) {
    if (inFenceLines.has(n)) continue;
    const line = doc.line(n);
    const text = line.text;
    let inCode = false;
    let k = 0;
    while (k < text.length) {
      const c = text[k];
      if (c === "`") {
        inCode = !inCode;
        k++;
        continue;
      }
      if (inCode || c !== "#") {
        k++;
        continue;
      }
      // `#` 前必须是行首或「非标签字符」（中文标点后面也允许，如 `：#数学`）
      const prevOk = k === 0 || !/[\p{L}\p{N}_/-]/u.test(text[k - 1]);
      if (!prevOk) {
        k++;
        continue;
      }
      // `#` 后紧跟 `#`（标题）或空白 → 不是标签
      if (k + 1 < text.length && (text[k + 1] === "#" || /\s/.test(text[k + 1]))) {
        k++;
        continue;
      }
      let j = k + 1;
      while (j < text.length && /[\p{L}\p{N}_/-]/u.test(text[j])) j++;
      if (j === k + 1) {
        k++;
        continue;
      }
      const body = text.slice(k + 1, j).replace(/^\/+|\/+$/g, "");
      if (!body || /^\d+$/.test(body)) {
        k = j;
        continue;
      }
      mark(line.from + k, line.from + j, tagDeco);
      k = j;
    }
  }

  // ---- 5. 行内公式 $...$ ----
  for (let n = 1; n <= doc.lines; n++) {
    const line = doc.line(n);
    const text = line.text;
    if (/^\s*(`{3,}|~{3,})/.test(text)) continue;
    if (text.trimStart().startsWith("$$")) continue;
    const active = isActivePos(line.from);

    let i = 0;
    while (i < text.length) {
      const c = text[i];
      if (c === "\\") {
        i += 2;
        continue;
      }
      if (c === "$" && text[i + 1] !== "$") {
        const end = text.indexOf("$", i + 1);
        if (end > i + 1 && text[end + 1] !== "$") {
          const tex = text.slice(i + 1, end);
          if (tex.trim()) {
            const from = line.from + i;
            const to = line.from + end + 1;
            if (active) {
              // 光标在本行：显示 $...$ 源码，方便编辑
              mark(from, to, mathDeco);
            } else {
              pending.push({
                from,
                to,
                deco: Decoration.replace({ widget: new InlineMathWidget(tex) }),
              });
            }
          }
          i = end + 1;
          continue;
        }
      }
      i++;
    }
  }

  // ---- 6. 排序 + 去重叠 ----
  pending.sort((a, b) => a.from - b.from || a.to - b.to);
  const builder = new RangeSetBuilder<Decoration>();
  let lastTo = -1;
  let lastZeroFrom = -1;
  for (const p of pending) {
    if (p.from === p.to) {
      if (p.from === lastZeroFrom) continue;
      lastZeroFrom = p.from;
    }
    if (p.from < lastTo) continue;
    builder.add(p.from, p.to, p.deco);
    lastTo = p.to;
  }
  return builder.finish();
}

/** 有序列表序号：正常显示但稍作弱化 */
const decorativeTextDeco = Decoration.mark({ class: "cm-ordered-num" });

// ---------------------------------------------------------------------------
// 双链点击：跳转 / 创建
// ---------------------------------------------------------------------------

/** 由 App 层注册的动作（避免编辑器直接依赖 store） */
interface WikiActions {
  /** 打开已存在的笔记 */
  open: (path: string) => void;
  /** 目标不存在时新建并打开 */
  create: (target: string) => void;
  /** 点击 `#标签`：按标签筛选 */
  filterTag?: (tag: string) => void;
}

let wikiActions: WikiActions | null = null;

/** 注册双链动作（App 挂载时调用一次） */
export function registerWikiActions(actions: WikiActions) {
  wikiActions = actions;
}

/**
 * 双链点击处理器。
 *
 * 用编辑器级 `domEventHandlers` 而不是 widget 内 `addEventListener`：
 * CodeMirror 会在 widget 外层包 `cm-widgetBuffer` 并接管鼠标事件，
 * widget 内部的监听经常收不到（任务复选框踩过同样的坑）。
 */
const wikiLinkHandler = EditorView.domEventHandlers({
  mousedown(event, view) {
    const target = event.target as HTMLElement | null;

    // 点击 #标签 → 按标签筛选（不需要 Ctrl）
    const tagEl = target?.closest?.(".cm-tag") as HTMLElement | null;
    if (tagEl) {
      const raw = (tagEl.textContent ?? "").replace(/^#/, "").trim();
      if (raw && wikiActions?.filterTag) {
        event.preventDefault();
        wikiActions.filterTag(raw);
        return true;
      }
    }

    const el = target?.closest?.(".cm-wikilink") as HTMLElement | null;
    if (!el) return false;

    const name = el.dataset.wikiTarget ?? "";
    const from = Number(el.dataset.wikiFrom);
    const to = Number(el.dataset.wikiTo);
    if (!name) return false;

    // Ctrl / Cmd + 点击 = 进入编辑（把光标放到链接源码里）
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      view.dispatch({ selection: { anchor: from } });
      view.focus();
      return true;
    }

    event.preventDefault();
    const path = resolveLinkTarget(name);
    if (path) {
      wikiActions?.open(path);
    } else {
      wikiActions?.create(name);
    }
    void to;
    return true;
  },
});

// ---------------------------------------------------------------------------
// StateField
// ---------------------------------------------------------------------------

/** 光标所在行是否变化 */
function selectionLineChanged(tr: Transaction): boolean {
  if (!tr.selection) return false;
  const before = tr.startState.doc.lineAt(tr.startState.selection.main.head).number;
  const after = tr.state.doc.lineAt(tr.state.selection.main.head).number;
  return before !== after;
}

export const livePreviewField = StateField.define<DecorationSet>({
  create(state) {
    return buildDecorations(state);
  },
  update(deco, tr) {
    const enabledChanged = tr.effects.some((e) => e.is(setLivePreview));
    if (tr.docChanged || enabledChanged || selectionLineChanged(tr)) {
      return buildDecorations(tr.state);
    }
    return deco.map(tr.changes);
  },
  provide: (f) => EditorView.decorations.from(f),
});

export const livePreview: Extension = [
  livePreviewEnabled,
  livePreviewField,
  taskCheckboxHandler,
  wikiLinkHandler,
  EditorView.atomicRanges.of(
    (view) => view.state.field(livePreviewField, false) ?? Decoration.none,
  ),
];

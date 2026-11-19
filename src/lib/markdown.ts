/** Markdown 渲染管线：markdown-it + KaTeX 公式 + 代码高亮 */

import MarkdownIt from "markdown-it";
import katex from "katex";
import hljs from "highlight.js/lib/common";

/** 行内公式：$...$ */
function inlineMath(state: any, silent: boolean): boolean {
  const start = state.pos;
  const src = state.src;
  if (src.charCodeAt(start) !== 0x24 /* $ */) return false;
  // 双 $ 交给块级公式处理
  if (src.charCodeAt(start + 1) === 0x24) return false;
  const max = state.posMax;
  let end = start + 1;
  while (end < max) {
    if (src.charCodeAt(end) === 0x24 /* $ */) {
      const ch = src.charCodeAt(end - 1);
      if (ch === 0x5c /* \ */) {
        end += 2;
        continue;
      }
      break;
    }
    end++;
  }
  if (end >= max) return false;
  const content = src.slice(start + 1, end);
  if (!content.trim()) return false;
  if (!silent) {
    const token = state.push("math_inline", "math", 0);
    token.content = content;
    token.markup = "$";
  }
  state.pos = end + 1;
  return true;
}

/** 块级公式：$$ ... $$ 独占一段 */
function blockMath(state: any, startLine: number, endLine: number, silent: boolean): boolean {
  const start = state.bMarks[startLine] + state.tShift[startLine];
  const max = state.eMarks[startLine];
  const src = state.src;
  if (start + 2 > max) return false;
  if (src.slice(start, start + 2) !== "$$") return false;
  let nextLine = startLine;
  let closed = false;
  let body = "";
  // 单行写完整：$$ x $$
  const afterOpen = src.slice(start + 2, max);
  const closeIdx = afterOpen.indexOf("$$");
  if (closeIdx >= 0) {
    body = afterOpen.slice(0, closeIdx);
    closed = true;
  } else {
    body = afterOpen;
    for (nextLine = startLine + 1; nextLine < endLine; nextLine++) {
      const ls = state.bMarks[nextLine] + state.tShift[nextLine];
      const le = state.eMarks[nextLine];
      const line = src.slice(ls, le);
      const idx = line.indexOf("$$");
      if (idx >= 0) {
        body += "\n" + line.slice(0, idx);
        closed = true;
        break;
      }
      body += "\n" + line;
    }
  }
  if (!closed) return false;
  if (silent) return true;
  const token = state.push("math_block", "math", 0);
  token.block = true;
  token.content = body.trim();
  token.map = [startLine, nextLine + 1];
  token.markup = "$$";
  state.line = nextLine + 1;
  return true;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderKatex(tex: string, displayMode: boolean): string {
  try {
    return katex.renderToString(tex, {
      displayMode,
      throwOnError: false,
      strict: "ignore",
      output: "html",
    });
  } catch {
    return `<code class="math-error">${escapeHtml(tex)}</code>`;
  }
}

/** 渲染任务列表复选框（`- [ ]` / `- [x]`） */
function taskListPlugin(md: MarkdownItInstance): void {
  md.core.ruler.after("inline", "peryx_task_list", (state) => {
    for (let i = 0; i < state.tokens.length; i++) {
      const t = state.tokens[i];
      if (t.type !== "inline") continue;
      const parent = state.tokens[i - 2];
      if (!parent || parent.type !== "paragraph_open") continue;
      const bullet = state.tokens[i - 3];
      if (!bullet || bullet.type !== "list_item_open") continue;
      const m = /^\[([ xX])\]\s+/.exec(t.content);
      if (!m) continue;
      const checked = m[1].toLowerCase() === "x";
      const children = t.children;
      if (!children || children.length === 0) continue;
      // 从第一个文本 token 中移除标记
      const first = children[0];
      first.content = first.content.replace(/^\[[ xX]\]\s+/, "");
      const box = new state.Token("html_inline", "", 0);
      box.content = `<input type="checkbox" class="task-checkbox" disabled${
        checked ? " checked" : ""
      } /> `;
      children.unshift(box);
      bullet.attrJoin("class", "task-item");
    }
    return true;
  });
}

/** 大纲锚点：给标题加上 id，供大纲面板跳转 */
function headingAnchorPlugin(md: MarkdownItInstance): void {
  md.core.ruler.push("peryx_heading_anchor", (state) => {
    let idx = 0;
    for (const t of state.tokens) {
      if (t.type === "heading_open") {
        t.attrSet("data-line", String(t.map ? t.map[0] : idx));
        idx++;
      }
    }
    return true;
  });
}

type MarkdownItInstance = ReturnType<typeof MarkdownIt>;

let renderer: MarkdownItInstance | null = null;

export function getMarkdown(): MarkdownItInstance {
  if (renderer) return renderer;
  const md = new MarkdownIt({
    html: false,
    linkify: true,
    typographer: false,
    breaks: false,
    highlight(code, lang) {
      if (lang && hljs.getLanguage(lang)) {
        try {
          return `<pre class="hljs"><code>${hljs.highlight(code, {
            language: lang,
            ignoreIllegals: true,
          }).value}</code></pre>`;
        } catch {
          /* fallthrough */
        }
      }
      return `<pre class="hljs"><code>${escapeHtml(code)}</code></pre>`;
    },
  });

  // 公式：先于 linkify 注册
  md.inline.ruler.after("escape", "math_inline", inlineMath);
  md.block.ruler.before("fence", "math_block", blockMath, {
    alt: ["paragraph", "reference", "blockquote", "list"],
  });

  md.renderer.rules.math_inline = (tokens, idx) =>
    renderKatex(tokens[idx].content, false);
  md.renderer.rules.math_block = (tokens, idx) =>
    `<div class="math-block">${renderKatex(tokens[idx].content, true)}</div>\n`;

  taskListPlugin(md);
  headingAnchorPlugin(md);

  // 外部链接在新窗口打开
  const defaultLink = md.renderer.rules.link_open;
  md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
    const href = String(tokens[idx].attrGet("href") ?? "");
    if (/^https?:\/\//i.test(href)) {
      tokens[idx].attrSet("target", "_blank");
      tokens[idx].attrSet("rel", "noopener noreferrer");
    }
    return defaultLink
      ? defaultLink(tokens, idx, options, env, self)
      : self.renderToken(tokens, idx, options);
  };

  renderer = md;
  return md;
}

/** 渲染整篇 Markdown 为 HTML */
export function renderMarkdown(source: string): string {
  return getMarkdown().render(source);
}

/** 只渲染单行片段（用于实时渲染模式的段落级渲染） */
export function renderInline(source: string): string {
  return getMarkdown().renderInline(source, {});
}

/** 渲染公式为 HTML（供实时渲染的 widget 使用） */
export function renderKatexHtml(tex: string, displayMode: boolean): string {
  return renderKatex(tex, displayMode);
}

/** 渲染代码块为 HTML（含语言高亮） */
export function renderCodeBlockHtml(code: string, lang: string): string {
  const language = (lang || "").trim().toLowerCase();
  if (language && hljs.getLanguage(language)) {
    try {
      const highlighted = hljs.highlight(code, { language, ignoreIllegals: true }).value;
      return `<pre class="hljs"><code>${highlighted}</code></pre>`;
    } catch {
      /* fallthrough */
    }
  }
  return `<pre class="hljs"><code>${escapeHtml(code)}</code></pre>`;
}

/** 提取标题大纲 */
export interface Heading {
  level: number;
  text: string;
  line: number;
}

export function extractHeadings(source: string): Heading[] {
  const lines = source.split("\n");
  const out: Heading[] = [];
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = /^(#{1,6})\s+(.*)$/.exec(line);
    if (m) {
      out.push({
        level: m[1].length,
        text: m[2].replace(/#+\s*$/, "").trim(),
        line: i,
      });
    }
  }
  return out;
}

/** 统计字数（中文按字、英文按词） */
export function countWords(source: string): { chars: number; words: number; lines: number } {
  const lines = source.split("\n").length;
  const cjk = (source.match(/[\u4e00-\u9fa5]/g) ?? []).length;
  const en = (source.match(/[a-zA-Z0-9_]+/g) ?? []).length;
  return { chars: source.length, words: cjk + en, lines };
}

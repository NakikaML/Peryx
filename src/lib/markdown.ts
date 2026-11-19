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

// ---------------------------------------------------------------------------
// Callouts（Obsidian 风格的 `> [!note] 标题`）
// ---------------------------------------------------------------------------

/** 支持的标注类型 → 图标 + 默认标题 */
export const CALLOUT_TYPES: Record<string, { icon: string; title: string }> = {
  note: { icon: "📝", title: "笔记" },
  info: { icon: "ℹ️", title: "信息" },
  tip: { icon: "💡", title: "提示" },
  hint: { icon: "💡", title: "提示" },
  success: { icon: "✅", title: "成功" },
  check: { icon: "✅", title: "成功" },
  warning: { icon: "⚠️", title: "警告" },
  caution: { icon: "⚠️", title: "警告" },
  danger: { icon: "🚨", title: "危险" },
  error: { icon: "🚨", title: "错误" },
  bug: { icon: "🐛", title: "缺陷" },
  question: { icon: "❓", title: "疑问" },
  example: { icon: "📋", title: "示例" },
  quote: { icon: "❝", title: "引用" },
  abstract: { icon: "📌", title: "摘要" },
  todo: { icon: "☑️", title: "待办" },
  important: { icon: "🔥", title: "重要" },
};

/** 把 `[!type]` 标记从引用块里抽出来做成标题 */
function calloutPlugin(md: MarkdownItInstance): void {
  md.core.ruler.after("inline", "peryx_callout", (state) => {
    const toks = state.tokens;
    // 倒序遍历，便于直接删除 token
    for (let i = toks.length - 1; i >= 0; i--) {
      const open = toks[i];
      if (open.type !== "blockquote_open") continue;

      // 找这一层 blockquote 的第一个 inline
      let depth = 1;
      let inlineIdx = -1;
      let closeIdx = -1;
      for (let j = i + 1; j < toks.length; j++) {
        const t = toks[j];
        if (t.type === "blockquote_open") depth++;
        else if (t.type === "blockquote_close") {
          depth--;
          if (depth === 0) {
            closeIdx = j;
            break;
          }
        } else if (depth === 1 && t.type === "inline" && inlineIdx < 0) {
          inlineIdx = j;
        }
      }
      if (inlineIdx < 0 || closeIdx < 0) continue;

      const inline = toks[inlineIdx];
      const children = inline.children;
      if (!children || children.length === 0) continue;
      const first = children[0];
      if (first.type !== "text") continue;

      const m = /^\[!([\w-]+)\]([+-]?)[ \t]*/.exec(first.content);
      if (!m) continue;
      const kind = m[1].toLowerCase();
      const meta = CALLOUT_TYPES[kind];
      if (!meta) continue; // 不认识的类型 → 当普通引用

      // 剩余内容作为标题（只取这一行）
      const rest = first.content.slice(m[0].length);
      const nl = rest.indexOf("\n");
      const titleText = (nl >= 0 ? rest.slice(0, nl) : rest).trim();
      const remaining = nl >= 0 ? rest.slice(nl + 1) : "";

      first.content = remaining;

      // 标题用行内 html 包起来（在 <p> 里放 div 是非法嵌套，所以用 span）
      const title = titleText || meta.title;
      const openTok = new state.Token("html_inline", "", 0);
      openTok.content = `<span class="callout-title"><span class="callout-icon">${meta.icon}</span><span class="callout-label">${escapeHtml(
        title,
      )}</span></span>`;
      children.unshift(openTok);

      // 整行只有标记、正文从下一段开始 → 去掉这个空段落
      if (!first.content.trim() && children.length === 1) {
        // children: [titleTok]，且 inline 之后紧跟 paragraph_close
        const pOpen = toks[inlineIdx - 1];
        const pClose = toks[inlineIdx + 1];
        if (pOpen?.type === "paragraph_open" && pClose?.type === "paragraph_close") {
          toks.splice(inlineIdx - 1, 3);
        }
      }

      open.attrJoin("class", `callout callout-${kind}`);
    }
    return true;
  });
}

// ---------------------------------------------------------------------------
// 脚注（`文字[^1]` + `[^1]: 解释`）
// ---------------------------------------------------------------------------

/**
 * 脚注实现（不引额外依赖）：
 *
 * 1. 预处理阶段把 `[^id]: 内容` 的定义行从正文里摘掉，存进 env
 * 2. 把正文里的 `[^id]` 换成上标链接
 * 3. 全文渲染完后，在末尾追加脚注区
 *
 * 与 Obsidian 一致：脚注区固定在文末，按**出现顺序**编号。
 */
function footnotePlugin(md: MarkdownItInstance): void {
  // 必须放在 block 解析**之前**：markdown-it 会把 `[^1]: 内容`
  // 当成链接引用定义直接吃掉，事后再改 token 已经来不及。
  md.core.ruler.before("block", "peryx_footnote_defs", (state) => {
    const defs = new Map<string, string>();
    const lines = state.src.split("\n");
    const kept: string[] = [];
    const defRe = /^\[\^([^\]\s]+)\]:\s?(.*)$/;

    for (let i = 0; i < lines.length; i++) {
      const m = defRe.exec(lines[i]);
      if (!m) {
        kept.push(lines[i]);
        continue;
      }
      // 定义可以续行（缩进 2 空格以上）
      let body = m[2];
      while (i + 1 < lines.length && /^\s{2,}\S/.test(lines[i + 1])) {
        i++;
        body += "\n" + lines[i].trim();
      }
      defs.set(m[1], body);
      kept.push(""); // 占位，保持后续行号不变
    }

    if (defs.size === 0) return true;
    state.src = kept.join("\n");
    (state.env as Record<string, unknown>).footnotes = defs;
    return true;
  });

  md.core.ruler.after("inline", "peryx_footnote_refs", (state) => {
    const defs = (state.env as Record<string, unknown>).footnotes as
      | Map<string, string>
      | undefined;
    if (!defs || defs.size === 0) return true;

    const order: string[] = [];
    const numberOf = (id: string): number => {
      let idx = order.indexOf(id);
      if (idx < 0) {
        order.push(id);
        idx = order.length - 1;
      }
      return idx + 1;
    };

    for (const tok of state.tokens) {
      if (tok.type !== "inline" || !tok.children) continue;
      const next: typeof tok.children = [];
      for (const child of tok.children) {
        if (child.type !== "text" || !child.content.includes("[^")) {
          next.push(child);
          continue;
        }
        const re = /\[\^([^\]\s]+)\]/g;
        let last = 0;
        let m: RegExpExecArray | null;
        let any = false;
        while ((m = re.exec(child.content))) {
          const id = m[1];
          if (!defs.has(id)) continue; // 没定义的当普通文本
          any = true;
          if (m.index > last) {
            const t = new state.Token("text", "", 0);
            t.content = child.content.slice(last, m.index);
            next.push(t);
          }
          const n = numberOf(id);
          const sup = new state.Token("html_inline", "", 0);
          sup.content = `<sup class="footnote-ref"><a href="#fn-${escapeHtml(
            id,
          )}" id="fnref-${escapeHtml(id)}" data-footnote="${escapeHtml(id)}">[${n}]</a></sup>`;
          next.push(sup);
          last = m.index + m[0].length;
        }
        if (!any) {
          next.push(child);
          continue;
        }
        if (last < child.content.length) {
          const t = new state.Token("text", "", 0);
          t.content = child.content.slice(last);
          next.push(t);
        }
      }
      tok.children = next;
    }

    if (order.length > 0) {
      const items = order
        .map((id, i) => {
          const body = defs.get(id) ?? "";
          return `<li id="fn-${escapeHtml(id)}"><span class="footnote-num">${
            i + 1
          }.</span> <span class="footnote-body">${escapeHtml(body).replace(
            /\n/g,
            "<br>",
          )}</span> <a class="footnote-back" href="#fnref-${escapeHtml(
            id,
          )}" data-footnote-back="${escapeHtml(id)}">↩</a></li>`;
        })
        .join("\n");
      const tail = new state.Token("html_block", "", 0);
      tail.content = `<hr class="footnotes-sep" />\n<ol class="footnotes">\n${items}\n</ol>\n`;
      state.tokens.push(tail);
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

  // mermaid：输出占位标签，由 React 端渲染成真实图表
  const defaultFence = md.renderer.rules.fence;
  md.renderer.rules.fence = (tokens, idx, options, env, self) => {
    const info = (tokens[idx].info || "").trim().split(/\s+/)[0].toLowerCase();
    if (info === "mermaid") {
      return `<div class="mermaid-block" data-mermaid="${escapeHtml(tokens[idx].content)}"></div>`;
    }
    return defaultFence
      ? defaultFence(tokens, idx, options, env, self)
      : self.renderToken(tokens, idx, options);
  };

  taskListPlugin(md);
  calloutPlugin(md);
  footnotePlugin(md);
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

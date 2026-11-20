/**
 * 导出 PDF。
 *
 * 实现方式：把笔记渲染成一份独立的打印用 HTML，塞进隐藏的 iframe，
 * 再调用 `iframe.contentWindow.print()`。WebView2（Chromium 内核）
 * 的打印对话框里可以选「另存为 PDF」。
 *
 * 为什么不自己生成 PDF：那需要引入排版引擎（或 Rust 侧 pdf 库），
 * 中文断行、公式矢量、代码高亮全都要重做一遍；
 * 浏览器自带的打印排版已经处理好了这些。
 *
 * 要点：
 * - 图片转成 data URL 内联，否则打印时外链图片会丢
 * - Mermaid 先渲染成内联 SVG
 * - 页边距、字体、代码背景写在 @page / @media print 里
 */

import { renderMarkdown } from "@/lib/markdown";
import { stripFrontmatter } from "@/lib/frontmatter";
import { renderMermaidSvg } from "@/lib/mermaid";
import { api } from "@/lib/api";
import { getCachedImage, resolveImagePath } from "@/lib/imageCache";
import {
  IMG_PLACEHOLDER_RE,
  LINK_PLACEHOLDER_RE,
  normalizeOwnSyntax,
} from "@/lib/ownSyntax";

function decodeHtml(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

export interface ExportOptions {
  /** 文档标题 */
  title: string;
  /** 笔记相对路径，用于解析 `![[图片]]` */
  docPath: string;
  /** Markdown 原文 */
  markdown: string;
}

/** 递归取图片的 data URL（优先缓存，未命中再问后端） */
async function imageDataUrl(target: string, docPath: string): Promise<string | null> {
  const key = resolveImagePath(target, docPath);
  const cached = getCachedImage(key);
  if (cached) return cached;
  try {
    const path = (await api.resolveAttachment(key).catch(() => null)) ?? key;
    const url = await api.readImageDataUrl(path);
    return url || null;
  } catch {
    return null;
  }
}

/**
 * 生成可直接打印的完整 HTML 文档。
 *
 * 单独成函数，方便测试检查生成结果（不真去调 print）。
 */
export async function buildPrintableHtml(opts: ExportOptions): Promise<string> {
  const { title, docPath, markdown } = opts;

  // 1) 先把自有语法换成占位符，再渲染
  // frontmatter 是元数据，不进 PDF 正文
  const normalized = normalizeOwnSyntax(stripFrontmatter(markdown));
  let html = renderMarkdown(normalized.text);

  // 2) 图片占位符 → 内联 data URL
  const urls = new Map<number, string | null>();
  for (let i = 0; i < normalized.images.length; i++) {
    urls.set(i, await imageDataUrl(normalized.images[i], docPath));
  }
  html = html.replace(IMG_PLACEHOLDER_RE, (_m, raw: string) => {
    const i = Number(raw);
    const target = normalized.images[i] ?? "";
    const url = urls.get(i);
    if (!url) return `<span class="doc-img-missing">🖼 ${escapeAttr(target)}</span>`;
    return `<img class="doc-img" src="${url}" alt="${escapeAttr(target)}" />`;
  });

  // 3) 双链占位符 → 纯文字（打印出来点了也没用）
  html = html.replace(LINK_PLACEHOLDER_RE, (_m, raw: string) => {
    const link = normalized.links[Number(raw)];
    if (!link) return "";
    return `<span class="doc-link">${escapeAttr(link.alias ?? link.target)}</span>`;
  });

  // 4) Mermaid → 内联 SVG
  const mermaidRe = /<div class="mermaid-block" data-mermaid="([\s\S]*?)"><\/div>/g;
  const pending: string[] = [];
  let bm: RegExpExecArray | null;
  while ((bm = mermaidRe.exec(html))) pending.push(decodeHtml(bm[1]));
  for (const code of pending) {
    let svg = "";
    try {
      svg = await renderMermaidSvg(code);
    } catch {
      svg = `<pre class="doc-mermaid-error">${escapeAttr(code)}</pre>`;
    }
    html = html.replace(
      /<div class="mermaid-block" data-mermaid="([\s\S]*?)"><\/div>/,
      `<div class="doc-mermaid">${svg}</div>`,
    );
  }

  const docTitle = title || "未命名笔记";
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>${escapeAttr(docTitle)}</title>
<style>
  @page { size: A4; margin: 18mm 16mm; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    color: #1f2328;
    background: #fff;
    font-family: "Segoe UI", "Microsoft YaHei", "PingFang SC", system-ui, sans-serif;
    font-size: 12.5pt;
    line-height: 1.75;
  }
  h1, h2, h3, h4 { line-height: 1.35; margin: 1.1em 0 0.5em; page-break-after: avoid; }
  h1 { font-size: 20pt; margin-top: 0; }
  h2 { font-size: 16pt; }
  h3 { font-size: 13.5pt; }
  p, ul, ol { margin: 0.5em 0; }
  ul, ol { padding-left: 1.6em; }
  blockquote {
    margin: 0.6em 0;
    padding: 0.2em 0 0.2em 1em;
    border-left: 3px solid #d0d7de;
    color: #59636e;
  }
  code {
    font-family: "Cascadia Code", Consolas, "Microsoft YaHei Mono", monospace;
    font-size: 0.9em;
    background: #f6f8fa;
    padding: 0.1em 0.3em;
    border-radius: 4px;
  }
  pre {
    background: #f6f8fa;
    border: 1px solid #e4e8ec;
    border-radius: 6px;
    padding: 10px 12px;
    overflow: auto;
    page-break-inside: avoid;
  }
  pre code { background: none; padding: 0; }
  table { border-collapse: collapse; width: 100%; margin: 0.8em 0; }
  th, td { border: 1px solid #d0d7de; padding: 5px 9px; text-align: left; }
  th { background: #f6f8fa; }
  img.doc-img { max-width: 100%; page-break-inside: avoid; }
  .doc-img-missing { color: #8c959f; }
  .doc-link { color: #1e66f5; text-decoration: underline; }
  .doc-mermaid { text-align: center; margin: 0.8em 0; page-break-inside: avoid; }
  .doc-mermaid svg { max-width: 100%; height: auto; }
  .katex-display { margin: 0.8em 0; }
  .callout {
    border: 1px solid #e4e8ec;
    border-left: 3px solid #179299;
    border-radius: 6px;
    padding: 8px 12px;
    margin: 0.8em 0;
    page-break-inside: avoid;
  }
  .callout-title { font-weight: 600; margin-bottom: 4px; }
  .footnotes { font-size: 0.9em; color: #59636e; border-top: 1px solid #e4e8ec; margin-top: 1.6em; }
  .mermaid-block { display: none; }
  ul.contains-task-list { list-style: none; padding-left: 1em; }
  input[type="checkbox"] { margin-right: 6px; }
  @media print {
    a { color: inherit; text-decoration: none; }
    h1, h2, h3 { break-after: avoid; }
    pre, table, img, .callout { break-inside: avoid; }
  }
</style>
</head>
<body>
<h1>${escapeAttr(docTitle)}</h1>
${html}
<script>
  // 图片全部内联，等渲染完直接弹打印
  window.addEventListener('load', function () {
    setTimeout(function () { window.focus(); window.print(); }, 120);
  });
</script>
</body>
</html>`;
}

/**
 * 导出当前笔记为 PDF（走系统打印对话框 → 另存为 PDF）。
 *
 * @returns 生成的 HTML 长度，便于调用方判断是否成功
 */
export async function exportNoteAsPdf(opts: ExportOptions): Promise<number> {
  const html = await buildPrintableHtml(opts);

  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText =
    "position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;pointer-events:none;";
  document.body.appendChild(frame);

  const doc = frame.contentDocument;
  if (!doc) throw new Error("无法创建打印文档");
  doc.open();
  doc.write(html);
  doc.close();

  // 打印对话框关闭后清理（没有可靠事件，延时兜底）
  window.setTimeout(() => {
    try {
      frame.remove();
    } catch {
      /* 已被清理 */
    }
  }, 60_000);

  return html.length;
}

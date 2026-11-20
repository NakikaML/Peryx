/**
 * 阅读模式：纯渲染视图（不显示任何 Markdown 源码）。
 *
 * 与实时渲染的区别：
 * - 实时渲染仍是编辑器，光标行会展开源码
 * - 阅读模式是只读 HTML，一个源码符号都不显示
 *
 * 复用 `markdown.ts` 的渲染管线，并额外处理本项目自有的语法：
 * `[[双链]]`、`![[图片]]`、`#标签`。
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { renderMarkdown } from "@/lib/markdown";
import { normalizeOwnSyntax } from "@/lib/ownSyntax";
import { stripFrontmatter } from "@/lib/frontmatter";
import { api } from "@/lib/api";
import { getCachedImage, onImageLoaded, resolveImagePath } from "@/lib/imageCache";
import { linkTargetExists, resolveLinkTarget } from "@/lib/linkCache";
import { MermaidDiagram } from "@/components/MermaidDiagram";

interface Props {
  /** Markdown 原文 */
  source: string;
  /** 当前笔记相对路径（解析图片用） */
  docPath: string;
  /** 点击双链 */
  onOpenLink?: (path: string) => void;
  /** 点击不存在笔记的双链 */
  onCreateLink?: (target: string) => void;
  /** 点击标签 */
  onTagClick?: (tag: string) => void;
  /** 双击正文 → 回到编辑 */
  onRequestEdit?: () => void;
}

/**
 * 自有语法（`![[图片]]` / `[[双链]]`）的预处理已抽到 lib/ownSyntax.ts，
 * 阅读模式与 PDF 导出共用同一份实现。
 */

export function ReadingView({
  source,
  docPath,
  onOpenLink,
  onCreateLink,
  onTagClick,
  onRequestEdit,
}: Props) {
  const [imgUrls, setImgUrls] = useState<Record<string, string | null>>({});
  const rootRef = useRef<HTMLDivElement | null>(null);

  const { text, images, links } = useMemo(
    // 阅读模式只看正文：frontmatter 属于属性面板，不在正文里重复一遍
    () => normalizeOwnSyntax(stripFrontmatter(source)),
    [source],
  );

  // 图片：先取缓存，未命中就异步加载
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const next: Record<string, string | null> = {};
      for (const target of images) {
        const key = resolveImagePath(target, docPath);
        const cached = getCachedImage(key);
        if (cached) {
          next[key] = cached;
          continue;
        }
        next[key] = null;
        void api
          .resolveAttachment(key)
          .catch(() => null)
          .then((resolved) => api.readImageDataUrl(resolved ?? key))
          .then((url) => {
            if (cancelled) return;
            setImgUrls((prev) => ({ ...prev, [key]: url }));
          })
          .catch(() => {
            if (cancelled) return;
            setImgUrls((prev) => ({ ...prev, [key]: "" }));
          });
      }
      if (!cancelled) setImgUrls((prev) => ({ ...next, ...prev }));
    };
    void load();
    // 编辑器那边加载完成也会通知
    const off = onImageLoaded(() => {
      const next: Record<string, string | null> = {};
      for (const target of images) {
        const key = resolveImagePath(target, docPath);
        const cached = getCachedImage(key);
        if (cached) next[key] = cached;
      }
      setImgUrls((prev) => ({ ...prev, ...next }));
    });
    return () => {
      cancelled = true;
      off();
    };
  }, [images, docPath]);

  const html = useMemo(() => {
    let out = renderMarkdown(text);

    // 图片占位符 → <img>
    out = out.replace(/\uE000IMG(\d+)\uE001/g, (_m, idx: string) => {
      const target = images[Number(idx)];
      if (target === undefined) return "";
      const key = resolveImagePath(target, docPath);
      const url = imgUrls[key];
      const name = escapeAttr(target);
      if (url === undefined || url === null) {
        return `<span class="read-img-pending">🖼 ${name}</span>`;
      }
      if (url === "") {
        return `<span class="read-img-failed">⚠ 图片无法加载：${name}</span>`;
      }
      return `<img class="read-img" src="${url}" alt="${name}" title="${name}" />`;
    });

    // 链接占位符 → <a>，附上 data 属性供点击处理
    out = out.replace(/\uE000LINK(\d+)\uE001/g, (_m, idx: string) => {
      const link = links[Number(idx)];
      if (!link) return "";
      const exists = linkTargetExists(link.target);
      const label = escapeHtml(link.alias ?? link.target);
      const cls = exists ? "read-link" : "read-link read-link-missing";
      const title = exists ? `跳转到「${escapeAttr(link.target)}」` : `「${escapeAttr(link.target)}」还不存在，点击创建`;
      return `<a class="${cls}" href="#" data-link="${escapeAttr(link.target)}" title="${title}">${label}</a>`;
    });

    return applyTags(out);
  }, [text, images, links, imgUrls, docPath]);

  /**
   * 把 HTML 按 mermaid 占位切成片段：
   * 普通片段直接塞 innerHTML，图表片段交给 <MermaidDiagram /> 渲染。
   */
  const parts = useMemo(() => {
    const segs: Array<{ kind: "html"; value: string } | { kind: "mermaid"; code: string }> = [];
    const re = /<div class="mermaid-block" data-mermaid="([\s\S]*?)"><\/div>/g;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html))) {
      if (m.index > last) segs.push({ kind: "html", value: html.slice(last, m.index) });
      segs.push({ kind: "mermaid", code: decodeHtml(m[1]) });
      last = m.index + m[0].length;
    }
    if (last < html.length) segs.push({ kind: "html", value: html.slice(last) });
    return segs;
  }, [html]);

  /** 点击委托：双链 / 标签 / 脚注 */
  const onClick = (e: React.MouseEvent) => {
    const el = e.target as HTMLElement;

    // 脚注：文内上标跳到文末，文末 ↩ 跳回原处
    const fnRef = el.closest(".footnote-ref a") as HTMLElement | null;
    if (fnRef) {
      e.preventDefault();
      const id = fnRef.dataset.footnote ?? "";
      const target = rootRef.current?.querySelector(`#fn-${cssEscape(id)}`);
      target?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    const fnBack = el.closest(".footnote-back") as HTMLElement | null;
    if (fnBack) {
      e.preventDefault();
      const id = fnBack.dataset.footnoteBack ?? "";
      const target = rootRef.current?.querySelector(`#fnref-${cssEscape(id)}`);
      target?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }

    const linkEl = el.closest("[data-link]") as HTMLElement | null;
    if (linkEl) {
      e.preventDefault();
      const target = linkEl.dataset.link ?? "";
      const path = resolveLinkTarget(target);
      if (path) onOpenLink?.(path);
      else onCreateLink?.(target);
      return;
    }

    const tagEl = el.closest("[data-read-tag]") as HTMLElement | null;
    if (tagEl) {
      e.preventDefault();
      onTagClick?.(tagEl.dataset.readTag ?? "");
    }
  };

  return (
    <div
      className="reading-view"
      onClick={onClick}
      onDoubleClick={() => onRequestEdit?.()}
      title="双击回到编辑"
    >
      <div ref={rootRef} className="reading-body markdown-body">
        {parts.map((p, i) =>
          p.kind === "html" ? (
            <div
              key={i}
              className="reading-chunk"
              dangerouslySetInnerHTML={{ __html: p.value }}
            />
          ) : (
            <MermaidDiagram key={i} code={p.code} />
          ),
        )}
      </div>
    </div>
  );
}

/** id 里可能有特殊字符，转义后再用于选择器 */
function cssEscape(s: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") return CSS.escape(s);
  return s.replace(/[^\w-]/g, (c) => `\\${c}`);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/'/g, "&#39;");
}

/** 反转义 markdown-it 输出的代码内容（用于取回 mermaid 源码） */
function decodeHtml(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/** 标签必须至少有一个非数字字符，且不含空格 */
const TAG_RE = /#([\p{L}\p{N}_/-]*[\p{L}_/-][\p{L}\p{N}_/-]*)/gu;

/**
 * 把正文文本里的 `#标签` 换成可点击的 span。
 *
 * 用 DOM 遍历而不是正则替换整段 HTML，这样天然跳过
 * `<pre>` / `<code>` / `<a>` / `<img>` 里的内容。
 */
function applyTags(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const skip = new Set(["PRE", "CODE", "A", "IMG", "SCRIPT", "STYLE"]);

  const walk = (node: Node) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        const text = child.textContent ?? "";
        if (!text.includes("#")) continue;
        TAG_RE.lastIndex = 0;
        if (!TAG_RE.test(text)) continue;
        TAG_RE.lastIndex = 0;

        const frag = doc.createDocumentFragment();
        let last = 0;
        let m: RegExpExecArray | null;
        while ((m = TAG_RE.exec(text))) {
          const start = m.index;
          // 前面紧贴字母数字时不算标签（比如 a#b）
          if (start > 0 && /[\p{L}\p{N}_/-]/u.test(text[start - 1])) continue;
          frag.appendChild(doc.createTextNode(text.slice(last, start)));
          const span = doc.createElement("span");
          span.className = "read-tag";
          span.dataset.readTag = m[1];
          span.textContent = m[0];
          span.title = `按标签筛选：${m[1]}`;
          frag.appendChild(span);
          last = start + m[0].length;
        }
        if (last === 0) continue;
        frag.appendChild(doc.createTextNode(text.slice(last)));
        node.replaceChild(frag, child);
        continue;
      }
      if (child.nodeType === Node.ELEMENT_NODE) {
        if (skip.has((child as Element).tagName)) continue;
        walk(child);
      }
    }
  };

  walk(doc.body);
  return doc.body.innerHTML;
}

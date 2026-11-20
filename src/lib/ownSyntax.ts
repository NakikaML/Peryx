/**
 * 把本项目自有语法（`![[图片]]` / `[[双链]]`）预处理成标准 Markdown 占位符，
 * 再交给 markdown-it 渲染。
 *
 * 阅读模式和 PDF 导出共用这一份，避免两边行为不一致。
 *
 * 占位符用 Unicode 私有区字符：`\u0000` 会被 markdown-it 当空字符吞掉。
 */

/** 图片扩展名（与后端 is_image_ext 保持一致） */
export const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|svg|avif)$/i;

export const IMG_PLACEHOLDER = (i: number) => `\uE000IMG${i}\uE001`;
export const LINK_PLACEHOLDER = (i: number) => `\uE000LINK${i}\uE001`;

export const IMG_PLACEHOLDER_RE = /\uE000IMG(\d+)\uE001/g;
export const LINK_PLACEHOLDER_RE = /\uE000LINK(\d+)\uE001/g;

export interface WikiLinkRef {
  target: string;
  alias: string | null;
}

export interface NormalizedDoc {
  /** 占位符化的 Markdown */
  text: string;
  /** 按占位符下标排列的图片目标 */
  images: string[];
  links: WikiLinkRef[];
}

export function normalizeOwnSyntax(source: string): NormalizedDoc {
  const images: string[] = [];
  const links: WikiLinkRef[] = [];
  let text = source;

  // 1) ![[图片]] → 占位符；不是图片的当笔记嵌入降级成普通双链
  text = text.replace(/!\[\[([^\]]+)\]\]/g, (_m, raw: string) => {
    const target = String(raw).split("|")[0].trim();
    if (!IMAGE_EXT.test(target)) {
      links.push({ target, alias: null });
      return `[[${target}]]`;
    }
    images.push(target);
    return IMG_PLACEHOLDER(images.length - 1);
  });

  // 2) [[目标|别名]] → 占位符
  text = text.replace(/\[\[([^\]]+)\]\]/g, (_m, raw: string) => {
    const parts = String(raw).split("|");
    links.push({
      target: parts[0].trim(),
      alias: parts.length > 1 ? parts[1].trim() : null,
    });
    return LINK_PLACEHOLDER(links.length - 1);
  });

  return { text, images, links };
}

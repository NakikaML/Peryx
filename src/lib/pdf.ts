/**
 * PDF 加载与渲染（基于 pdf.js）。
 *
 * pdf.js 约 1MB，用动态 import 拆成独立 chunk，打开 PDF 时才加载。
 * worker 用 Vite 的 `?url` 导入，避免主线程卡死。
 */

/** pdf.js 的 document 类型（避免直接把 pdfjs 的类型泄露到各处） */
type PdfDoc = Awaited<ReturnType<typeof openDocument>>;

let pdfjsPromise: Promise<any> | null = null;

async function getPdfjs(): Promise<any> {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const pdfjs = await import("pdfjs-dist");
      const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
      return pdfjs;
    })();
  }
  return pdfjsPromise;
}

/** 从 `data:` URL 取出字节（base64 → Uint8Array） */
export function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** 已打开的文档缓存（按 data URL，最多留 2 份，避免重复解析大文件） */
const docCache = new Map<string, PdfDoc>();
const CACHE_LIMIT = 2;

async function openDocument(dataUrl: string): Promise<any> {
  const pdfjs = await getPdfjs();
  const bytes = dataUrlToBytes(dataUrl);
  // pdf.js 会接管这块内存，传副本更安全
  return pdfjs.getDocument({ data: bytes.slice() }).promise;
}

/** 打开一份 PDF（带缓存） */
export async function loadPdf(dataUrl: string): Promise<PdfDoc> {
  const hit = docCache.get(dataUrl);
  if (hit) return hit;
  const doc = await openDocument(dataUrl);
  docCache.set(dataUrl, doc);
  // 超限时丢掉最早的一份
  while (docCache.size > CACHE_LIMIT) {
    const first = docCache.keys().next().value as string | undefined;
    if (first === undefined) break;
    const old = docCache.get(first);
    docCache.delete(first);
    try {
      await old?.destroy?.();
    } catch {
      /* 忽略 */
    }
  }
  return doc;
}

/** 清空缓存（关闭 PDF 或切换库时） */
export async function clearPdfCache() {
  for (const doc of docCache.values()) {
    try {
      await doc.destroy?.();
    } catch {
      /* 忽略 */
    }
  }
  docCache.clear();
}

export interface RenderOptions {
  /** 缩放倍数（1 = 原始大小） */
  scale: number;
  /** 设备像素比，保证高分屏清晰 */
  dpr?: number;
}

/**
 * 把某一页渲染到 canvas 上。
 *
 * @returns 渲染后的 CSS 尺寸（用于占位）
 */
export async function renderPage(
  doc: PdfDoc,
  pageNumber: number,
  canvas: HTMLCanvasElement,
  opts: RenderOptions,
): Promise<{ width: number; height: number }> {
  const page = await doc.getPage(pageNumber);
  const dpr = opts.dpr ?? window.devicePixelRatio ?? 1;
  const viewport = page.getViewport({ scale: opts.scale });
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("无法创建 canvas 上下文");

  canvas.width = Math.floor(viewport.width * dpr);
  canvas.height = Math.floor(viewport.height * dpr);
  canvas.style.width = `${Math.floor(viewport.width)}px`;
  canvas.style.height = `${Math.floor(viewport.height)}px`;

  await page.render({
    canvasContext: ctx,
    viewport,
    transform: dpr === 1 ? undefined : [dpr, 0, 0, dpr, 0, 0],
  }).promise;

  return { width: Math.floor(viewport.width), height: Math.floor(viewport.height) };
}

/** 取第 n 页在 scale=1 时的尺寸（用于提前占位，避免滚动跳动） */
export async function pageSize(
  doc: PdfDoc,
  pageNumber: number,
): Promise<{ width: number; height: number }> {
  const page = await doc.getPage(pageNumber);
  const vp = page.getViewport({ scale: 1 });
  return { width: vp.width, height: vp.height };
}

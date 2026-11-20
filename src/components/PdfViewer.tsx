/**
 * PDF 阅读器。
 *
 * - 连续滚动，所有页一次性排版、按需渲染（IntersectionObserver）
 * - 顶部工具条：页码跳转、上一页/下一页、缩放
 * - 加载与解析失败都有明确提示，不会白屏
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { loadPdf, pageSize, renderPage } from "@/lib/pdf";
import { api, errText } from "@/lib/api";

interface Props {
  /** 资料文件相对路径 */
  path: string;
  /** 显示用标题 */
  title: string;
  onClose: () => void;
}

interface PageSlot {
  n: number;
  /** scale=1 时的尺寸，用于占位 */
  w: number;
  h: number;
}

const ZOOMS = [0.6, 0.75, 0.9, 1, 1.25, 1.5, 1.75, 2];

export function PdfViewer({ path, title, onClose }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [doc, setDoc] = useState<any>(null);
  const [pages, setPages] = useState<PageSlot[]>([]);
  const [zoom, setZoom] = useState(1);
  const [current, setCurrent] = useState(1);
  /** 已渲染的页，避免重复渲染 */
  const rendered = useRef<Set<string>>(new Set());
  const canvasRefs = useRef<Map<number, HTMLCanvasElement>>(new Map());
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);

  // 加载文档
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    setDoc(null);
    setPages([]);
    rendered.current.clear();

    (async () => {
      try {
        const url = await api.readResourceDataUrl(path);
        const d = await loadPdf(url);
        if (cancelled) return;
        const slots: PageSlot[] = [];
        for (let n = 1; n <= d.numPages; n++) {
          const size = await pageSize(d, n);
          slots.push({ n, w: size.width, h: size.height });
        }
        if (cancelled) return;
        setDoc(d);
        setPages(slots);
        setCurrent(1);
        setLoading(false);
      } catch (e) {
        if (cancelled) return;
        setError(errText(e));
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      observerRef.current?.disconnect();
    };
  }, [path]);

  /** 渲染某一页 */
  const renderOne = useCallback(
    async (n: number) => {
      if (!doc) return;
      const key = `${n}@${zoom}`;
      if (rendered.current.has(key)) return;
      const canvas = canvasRefs.current.get(n);
      if (!canvas) return;
      rendered.current.add(key);
      try {
        await renderPage(doc, n, canvas, { scale: zoom });
      } catch {
        rendered.current.delete(key);
      }
    },
    [doc, zoom],
  );

  // 缩放变化后清掉已渲染标记，重新渲染可见页
  useEffect(() => {
    rendered.current.clear();
    observerRef.current?.disconnect();
    const obs = new IntersectionObserver(
      (entries) => {
        for (const en of entries) {
          if (en.isIntersecting) {
            const n = Number((en.target as HTMLElement).dataset.page);
            if (n) void renderOne(n);
          }
        }
      },
      { root: scrollRef.current, rootMargin: "300px 0px" },
    );
    observerRef.current = obs;
    for (const el of Array.from(scrollRef.current?.querySelectorAll(".pdf-page") ?? [])) {
      obs.observe(el);
    }
    return () => obs.disconnect();
  }, [doc, zoom, pages, renderOne]);

  /** 滚动时更新当前页码 */
  const onScroll = () => {
    const root = scrollRef.current;
    if (!root) return;
    const top = root.getBoundingClientRect().top;
    let best = 1;
    let bestDist = Infinity;
    for (const el of Array.from(root.querySelectorAll<HTMLElement>(".pdf-page"))) {
      const d = Math.abs(el.getBoundingClientRect().top - top - 8);
      if (d < bestDist) {
        bestDist = d;
        best = Number(el.dataset.page ?? 1);
      }
    }
    setCurrent(best);
  };

  const goto = (n: number) => {
    const clamped = Math.max(1, Math.min(pages.length, n));
    setCurrent(clamped);
    const el = scrollRef.current?.querySelector<HTMLElement>(`[data-page="${clamped}"]`);
    el?.scrollIntoView({ block: "start" });
  };

  const zoomIndex = ZOOMS.indexOf(zoom);
  const totalW = useMemo(() => {
    const p = pages[0];
    return p ? Math.round(p.w * zoom) : 0;
  }, [pages, zoom]);

  return (
    <div className="pdf-viewer">
      <div className="pdf-head">
        <span className="pdf-title" title={path}>
          📄 {title}
        </span>

        <div className="pdf-actions">
          <button
            className="icon-btn"
            title="上一页"
            disabled={current <= 1}
            onClick={() => goto(current - 1)}
          >
            ‹
          </button>
          <span className="pdf-pageinfo">
            <input
              className="pdf-pageinput"
              value={current}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (Number.isFinite(v)) goto(v);
              }}
            />
            / {pages.length || "?"}
          </span>
          <button
            className="icon-btn"
            title="下一页"
            disabled={current >= pages.length}
            onClick={() => goto(current + 1)}
          >
            ›
          </button>

          <button
            className="icon-btn"
            title="缩小"
            disabled={zoomIndex <= 0}
            onClick={() => setZoom(ZOOMS[Math.max(0, zoomIndex - 1)])}
          >
            −
          </button>
          <span className="pdf-zoom">{Math.round(zoom * 100)}%</span>
          <button
            className="icon-btn"
            title="放大"
            disabled={zoomIndex >= ZOOMS.length - 1}
            onClick={() => setZoom(ZOOMS[Math.min(ZOOMS.length - 1, zoomIndex + 1)])}
          >
            +
          </button>

          <button className="icon-btn" title="关闭" onClick={onClose}>
            ✕
          </button>
        </div>
      </div>

      <div className="pdf-body" ref={scrollRef} onScroll={onScroll}>
        {loading && <div className="pdf-status">正在加载 PDF…</div>}
        {!loading && error && (
          <div className="pdf-status pdf-status-error">
            ⚠ 无法打开这份 PDF：{error}
          </div>
        )}
        {!loading && !error && (
          <div className="pdf-pages" style={{ width: totalW ? totalW + 32 : undefined }}>
            {pages.map((p) => (
              <div
                key={p.n}
                className="pdf-page"
                data-page={p.n}
                style={{ width: p.w * zoom, height: p.h * zoom }}
              >
                <canvas
                  ref={(el) => {
                    if (el) canvasRefs.current.set(p.n, el);
                    else canvasRefs.current.delete(p.n);
                  }}
                />
                <span className="pdf-page-no">{p.n}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

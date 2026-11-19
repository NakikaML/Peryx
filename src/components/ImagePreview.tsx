/** 图片预览：在右侧编辑区显示图片（点击文件树里的图片时使用） */

import { useEffect, useState } from "react";
import { api, errText } from "@/lib/api";
import { getCachedImage, onImageLoaded } from "@/lib/imageCache";

interface Props {
  path: string;
}

/** 从路径取文件名 */
function baseName(p: string): string {
  const parts = p.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts[parts.length - 1] ?? p;
}

export function ImagePreview({ path }: Props) {
  const [url, setUrl] = useState<string | null>(() => getCachedImage(path));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // 缓存命中直接显示
    const cached = getCachedImage(path);
    if (cached) {
      setUrl(cached);
      setError(null);
      return;
    }
    // 未命中：自己发一次请求（不依赖编辑器那套 widget 机制）
    let cancelled = false;
    setUrl(null);
    setError(null);
    void api
      .readImageDataUrl(path)
      .then((dataUrl) => {
        if (!cancelled) setUrl(dataUrl);
      })
      .catch((e) => {
        if (!cancelled) setError(errText(e));
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  // 编辑器那边加载完成也会走到这里
  useEffect(() => {
    return onImageLoaded(() => {
      const cached = getCachedImage(path);
      if (cached) setUrl(cached);
    });
  }, [path]);

  const name = baseName(path);

  return (
    <div className="image-preview">
      <div className="image-preview-head">
        <span className="image-preview-title">🖼 {name}</span>
        <span className="image-preview-path">{path}</span>
      </div>
      <div className="image-preview-body">
        {error && <div className="image-preview-error">⚠ 无法加载图片：{error}</div>}
        {!error && !url && <div className="image-preview-loading">正在加载…</div>}
        {url && (
          <img
            className="image-preview-img"
            src={url}
            alt={name}
            title={name}
            // 点击在新窗口打开原图（方便查看大图细节）
            onClick={() => {
              if (url.startsWith("data:")) {
                const w = window.open();
                if (w) w.document.write(`<title>${name}</title><img src="${url}" style="max-width:100%">`);
              }
            }}
          />
        )}
      </div>
    </div>
  );
}

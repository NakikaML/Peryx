/**
 * Mermaid 图渲染（React 组件）。
 *
 * 体积较大的 mermaid 通过 lib/mermaid 动态加载：只有笔记里真的出现
 * ```mermaid 代码块时才加载，不影响首屏。
 *
 * 渲染失败（语法错误）时显示错误信息 + 原始代码，不会白屏。
 */

import { useEffect, useRef, useState } from "react";
import { renderMermaidSvg } from "@/lib/mermaid";

interface Props {
  code: string;
}

export function MermaidDiagram({ code }: Props) {
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    setSvg(null);
    setError(null);
    setLoading(true);

    void (async () => {
      try {
        const out = await renderMermaidSvg(code);
        if (!aliveRef.current) return;
        setSvg(out);
      } catch (e) {
        if (!aliveRef.current) return;
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (aliveRef.current) setLoading(false);
      }
    })();

    return () => {
      aliveRef.current = false;
    };
  }, [code]);

  if (error) {
    return (
      <div className="mermaid-error">
        <div className="mermaid-error-title">⚠ Mermaid 渲染失败</div>
        <div className="mermaid-error-msg">{error}</div>
        <pre className="mermaid-error-src">{code}</pre>
      </div>
    );
  }

  if (loading || !svg) {
    return <div className="mermaid-loading">正在渲染图表…</div>;
  }

  return (
    <div
      className="mermaid-diagram"
      // 内容来自 mermaid 自身的 SVG 输出
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

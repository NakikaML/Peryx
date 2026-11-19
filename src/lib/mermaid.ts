/**
 * Mermaid 渲染（共享给阅读模式和实时渲染）。
 *
 * mermaid 体积约 1MB，所以动态 import：只有笔记里真的出现图表时才加载。
 */

type MermaidApi = {
  initialize: (config: Record<string, unknown>) => void;
  render: (id: string, code: string) => Promise<{ svg: string }>;
};

let mermaidPromise: Promise<MermaidApi> | null = null;
let idSeq = 0;

function loadMermaid(): Promise<MermaidApi> {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid").then((mod) => {
      const api = (mod.default ?? mod) as unknown as MermaidApi;
      api.initialize({
        startOnLoad: false,
        theme: "base",
        securityLevel: "strict",
        fontFamily: "inherit",
        themeVariables: {
          primaryColor: "#e8f1ef",
          primaryTextColor: "#243b3a",
          primaryBorderColor: "#2f6f6b",
          lineColor: "#7a8f8d",
          secondaryColor: "#f1f5f4",
          tertiaryColor: "#ffffff",
        },
      });
      return api;
    });
  }
  return mermaidPromise;
}

/** 渲染 mermaid 源码为 SVG 字符串；语法错误会抛出 */
export async function renderMermaidSvg(code: string): Promise<string> {
  const api = await loadMermaid();
  const id = `peryx-mermaid-${++idSeq}`;
  const { svg } = await api.render(id, code);
  return svg;
}

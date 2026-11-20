/**
 * 侧边栏下半部分：资料库。
 *
 * 与上半部分的笔记树**完全隔离**：
 * - 只列非 Markdown 资料（PDF 为主），md 文件留给笔记树
 * - 目录可展开；点击 PDF 在右侧打开阅读器
 *
 * 这一版只保证 PDF 能读；docx / pptx / xlsx 等先列出来，
 * 点击会提示暂不支持。
 */

import { useEffect, useState } from "react";
import { useStore } from "@/stores/app";
import type { FileNode } from "@/lib/types";

/** 能直接阅读的格式 */
const READABLE = /\.pdf$/i;

function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toUpperCase() : "";
}

function fileIcon(name: string): string {
  if (/\.pdf$/i.test(name)) return "📕";
  if (/\.docx?$/i.test(name)) return "📘";
  if (/\.pptx?$/i.test(name)) return "📙";
  if (/\.xlsx?$/i.test(name)) return "📗";
  if (/\.(zip|rar|7z)$/i.test(name)) return "🗜";
  if (/\.(epub|mobi)$/i.test(name)) return "📖";
  if (/\.txt$/i.test(name)) return "📄";
  return "📎";
}

export function ResourcePane() {
  const resourceDir = useStore((s) => s.resourceDir);
  const resources = useStore((s) => s.resources);
  const activePath = useStore((s) => s.resource?.path ?? null);
  const loadResources = useStore((s) => s.loadResources);
  const openResource = useStore((s) => s.openResource);
  const toast = useStore((s) => s.toast);

  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);

  // 首次挂载时加载根目录
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void loadResources("").finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [loadResources]);

  const root = resources[resourceDir] ?? [];

  const onOpen = (node: FileNode) => {
    if (node.isDir) {
      setExpanded((prev) => ({ ...prev, [node.path]: !prev[node.path] }));
      if (!resources[node.path]) void loadResources(node.path);
      return;
    }
    if (READABLE.test(node.name)) {
      openResource(node.path);
    } else {
      toast(`「${extOf(node.name)}」暂时还不能预览，后续版本支持`, "error");
    }
  };

  const renderNode = (node: FileNode, depth: number) => {
    const isDir = node.isDir;
    const isOpen = !!expanded[node.path];
    const kids = resources[node.path] ?? [];
    const active = activePath === node.path;
    return (
      <div key={node.path}>
        <div
          className={`res-item ${active ? "active" : ""}`}
          style={{ paddingLeft: 8 + depth * 14 }}
          title={node.path}
          onClick={() => onOpen(node)}
        >
          <span className="res-caret">{isDir ? (isOpen ? "▾" : "▸") : ""}</span>
          <span className="res-icon">{isDir ? "📁" : fileIcon(node.name)}</span>
          <span className="res-name">{node.name}</span>
        </div>
        {isDir && isOpen &&
          (kids.length === 0 ? (
            <div className="res-empty" style={{ paddingLeft: 30 + depth * 14 }}>
              空
            </div>
          ) : (
            kids.map((k) => renderNode(k, depth + 1))
          ))}
      </div>
    );
  };

  return (
    <div className="resource-pane">
      <div className="resource-head">
        <span className="resource-title">📚 资料库</span>
        <button
          className="resource-refresh"
          title="刷新资料库"
          onClick={() => {
            void loadResources("");
            for (const p of Object.keys(resources)) {
              if (p !== resourceDir) void loadResources(p);
            }
          }}
        >
          ↻
        </button>
      </div>

      <div className="resource-body">
        {loading && root.length === 0 && <div className="res-empty">正在读取…</div>}
        {!loading && root.length === 0 && (
          <div className="res-empty">
            把 PDF 等资料放进笔记库的「{resourceDir}」文件夹
          </div>
        )}
        {root.map((n) => renderNode(n, 0))}
      </div>
    </div>
  );
}

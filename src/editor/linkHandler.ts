/**
 * 链接交互扩展：
 *  - Ctrl/Cmd + 点击链接文字 → 用系统浏览器打开
 *  - 普通点击 → 正常定位光标（不跳转）
 *
 * 这样既保留了编辑能力，又能跳转。
 */

import { EditorView } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import { isTauri } from "@/lib/api";

/** 在当前位置找到外链 URL */
function linkAt(view: EditorView, pos: number): string | null {
  const line = view.state.doc.lineAt(pos);
  const text = line.text;
  const rel = pos - line.from;

  // 匹配 markdown 链接 [text](url)
  const re = /\[([^\]]*)\]\(([^)\s]+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const start = m.index;
    const end = m.index + m[0].length;
    if (rel >= start && rel <= end) return m[2];
  }

  // 裸 URL
  const urlRe = /(https?:\/\/[^\s)<>]+)/g;
  while ((m = urlRe.exec(text)) !== null) {
    const start = m.index;
    const end = m.index + m[0].length;
    if (rel >= start && rel <= end) return m[0];
  }
  return null;
}

async function openExternal(url: string): Promise<void> {
  // 只允许 http/https，避免危险协议
  if (!/^https?:\/\//i.test(url)) return;
  try {
    if (isTauri) {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl(url);
    } else {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  } catch {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

/** Ctrl/Cmd + 点击打开链接，并显示手型光标 */
export const linkClickHandler: Extension = EditorView.domEventHandlers({
  mousedown(event, view) {
    if (!(event.ctrlKey || event.metaKey)) return false;
    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
    if (pos == null) return false;
    const url = linkAt(view, pos);
    if (!url) return false;
    event.preventDefault();
    void openExternal(url);
    return true;
  },
});

/**
 * 鼠标悬停在链接上时显示手型光标。
 * 通过 mousemove 动态判断，避免影响其他区域。
 */
export const linkCursorHandler: Extension = EditorView.domEventHandlers({
  mousemove(event, view) {
    const target = event.target as HTMLElement | null;
    if (!target) return false;
    // 只在链接文字区域尝试
    const el = target.closest(".cm-link-text");
    if (!el) {
      view.dom.style.cursor = "";
      return false;
    }
    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
    if (pos == null) return false;
    const url = linkAt(view, pos);
    view.dom.style.cursor = url ? "pointer" : "";
    return false;
  },
});

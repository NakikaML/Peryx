/**
 * 单篇笔记自己的视图切换（编辑 / 源码 / 阅读）。
 *
 * 放在笔记顶部、工具栏下方——每篇笔记各自记忆自己的模式，
 * 与 Obsidian 右上角那个小开关一致。
 */

import type { EditorMode } from "@/lib/types";

interface Props {
  mode: EditorMode;
  onChange: (mode: EditorMode) => void;
  /** 紧凑尺寸（分屏里用） */
  compact?: boolean;
}

const MODES: { mode: EditorMode; label: string; icon: string; title: string }[] = [
  {
    mode: "live",
    label: "编辑",
    icon: "✎",
    title: "编辑：实时渲染，隐藏 Markdown 符号",
  },
  {
    mode: "source",
    label: "源码",
    icon: "</>",
    title: "源码：显示完整 Markdown 语法",
  },
  {
    mode: "read",
    label: "阅读",
    icon: "❐",
    title: "阅读：只显示排版结果（双击正文回到编辑）",
  },
];

export function PaneModeSwitch({ mode, onChange, compact }: Props) {
  return (
    <div
      className={`pane-mode-switch ${compact ? "compact" : ""}`}
      role="group"
      aria-label="视图模式"
    >
      {MODES.map((m) => (
        <button
          key={m.mode}
          data-mode={m.mode}
          className={`pane-mode-btn ${mode === m.mode ? "on" : ""}`}
          title={m.title}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onChange(m.mode)}
        >
          <span className="pane-mode-icon">{m.icon}</span>
          {!compact && <span className="pane-mode-label">{m.label}</span>}
        </button>
      ))}
    </div>
  );
}

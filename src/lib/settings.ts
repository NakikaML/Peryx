/**
 * 应用设置：字体大小、各类 Markdown 样式、快捷键。
 *
 * 存储位置与笔记库无关（放应用配置目录），
 * 通过 Rust 的 save_settings / load_settings 命令读写。
 *
 * 样式通过 CSS 变量下发，这样无需重建 CodeMirror 主题即可即时生效。
 */

import { api } from "@/lib/api";
import { applyTheme, DEFAULT_THEME_ID } from "@/lib/theme";

/** 可自定义外观的元素 */
export interface StyleRule {
  /** 文字颜色（空字符串 = 用主题默认色） */
  color: string;
  /** 字体（空字符串 = 默认字体） */
  fontFamily: string;
  /** 字号缩放倍数（1 = 不变） */
  scale: number;
  /** 是否加粗（仅部分元素有意义） */
  bold: boolean;
  /** 是否斜体（仅部分元素有意义） */
  italic: boolean;
}

/** 可调整外观的元素键 */
export type StyleKey =
  | "paragraph"
  | "h1"
  | "h2"
  | "h3"
  | "bold"
  | "italic"
  | "strike"
  | "highlight"
  | "quote"
  | "list"
  | "link";

/** 快捷键动作名 */
export type ShortcutAction =
  | "sidebar"
  | "rightSidebar"
  | "settings"
  | "newNote"
  | "newFolder"
  | "save"
  | "toggleMode"
  | "commandPalette"
  | "globalSearch"
  | "bold"
  | "italic"
  | "inlineCode"
  | "refresh";

export interface Settings {
  /** 主题预设 id（见 lib/theme.ts） */
  theme: string;
  /** 编辑器正文字号（px） */
  fontSize: number;
  /** 行高倍数 */
  lineHeight: number;
  /** 各元素的样式覆盖 */
  styles: Record<StyleKey, StyleRule>;
  /** 快捷键：动作 → 组合键字符串（如 "Ctrl+N"、"Alt+1"） */
  shortcuts: Record<ShortcutAction, string>;
}

/** 默认样式：留空表示沿用主题 */
function defaultRule(): StyleRule {
  return { color: "", fontFamily: "", scale: 1, bold: false, italic: false };
}

export const DEFAULT_SHORTCUTS: Record<ShortcutAction, string> = {
  sidebar: "Alt+1",
  rightSidebar: "Alt+4",
  settings: "Alt+0",
  newNote: "Ctrl+N",
  newFolder: "Ctrl+Shift+N",
  save: "Ctrl+S",
  toggleMode: "Ctrl+Shift+P",
  commandPalette: "Ctrl+P",
  globalSearch: "Ctrl+Shift+F",
  bold: "Ctrl+B",
  italic: "Ctrl+I",
  inlineCode: "Ctrl+E",
  refresh: "Ctrl+O",
};

/** 快捷键动作的中文名（设置面板里展示） */
export const SHORTCUT_LABELS: Record<ShortcutAction, string> = {
  sidebar: "显示/隐藏左侧边栏",
  rightSidebar: "显示/隐藏右侧边栏",
  settings: "打开设置",
  newNote: "新建笔记",
  newFolder: "新建文件夹",
  save: "保存",
  toggleMode: "切换实时渲染 / 源码",
  commandPalette: "命令面板",
  globalSearch: "全局搜索",
  bold: "加粗",
  italic: "斜体",
  inlineCode: "行内代码",
  refresh: "刷新目录树",
};

/** 可自定义样式的元素（设置面板里展示） */
export const STYLE_LABELS: { key: StyleKey; label: string; hint?: string }[] = [
  { key: "paragraph", label: "正文" },
  { key: "h1", label: "一级标题" },
  { key: "h2", label: "二级标题" },
  { key: "h3", label: "三级标题" },
  { key: "bold", label: "加粗" },
  { key: "italic", label: "斜体" },
  { key: "strike", label: "删除线" },
  { key: "highlight", label: "高亮" },
  { key: "quote", label: "引用块" },
  { key: "list", label: "列表" },
  { key: "link", label: "链接" },
];

export function defaultSettings(): Settings {
  const styles = {} as Record<StyleKey, StyleRule>;
  for (const { key } of STYLE_LABELS) styles[key] = defaultRule();
  return {
    theme: DEFAULT_THEME_ID,
    fontSize: 18,
    lineHeight: 1.75,
    styles,
    shortcuts: { ...DEFAULT_SHORTCUTS },
  };
}

/** 合并后端读回的设置与默认值，兼容旧版本缺失字段 */
export function normalizeSettings(raw: unknown): Settings {
  const base = defaultSettings();
  if (!raw || typeof raw !== "object") return base;
  const s = raw as Partial<Settings>;
  const out: Settings = {
    theme: typeof s.theme === "string" && s.theme ? s.theme : base.theme,
    fontSize: typeof s.fontSize === "number" && s.fontSize >= 10 && s.fontSize <= 32 ? s.fontSize : base.fontSize,
    lineHeight:
      typeof s.lineHeight === "number" && s.lineHeight >= 1 && s.lineHeight <= 3
        ? s.lineHeight
        : base.lineHeight,
    styles: { ...base.styles },
    shortcuts: { ...base.shortcuts },
  };
  if (s.styles && typeof s.styles === "object") {
    for (const { key } of STYLE_LABELS) {
      const r = (s.styles as Record<string, Partial<StyleRule>>)[key];
      if (!r) continue;
      out.styles[key] = {
        color: typeof r.color === "string" ? r.color : "",
        fontFamily: typeof r.fontFamily === "string" ? r.fontFamily : "",
        scale: typeof r.scale === "number" && r.scale > 0.4 && r.scale < 3 ? r.scale : 1,
        bold: !!r.bold,
        italic: !!r.italic,
      };
    }
  }
  if (s.shortcuts && typeof s.shortcuts === "object") {
    for (const key of Object.keys(base.shortcuts) as ShortcutAction[]) {
      const v = (s.shortcuts as Record<string, string>)[key];
      if (typeof v === "string" && v.trim()) out.shortcuts[key] = v.trim();
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// CSS 变量下发
// ---------------------------------------------------------------------------

/** 样式键 → CSS 变量前缀 */
const VAR_PREFIX: Record<StyleKey, string> = {
  paragraph: "--md-p",
  h1: "--md-h1",
  h2: "--md-h2",
  h3: "--md-h3",
  bold: "--md-b",
  italic: "--md-i",
  strike: "--md-s",
  highlight: "--md-mark",
  quote: "--md-quote",
  list: "--md-list",
  link: "--md-link",
};

/** 主题会自带配色的元素：用户没自定义颜色时必须保留主题色 */
const THEME_COLORED: StyleKey[] = ["h1", "h2", "h3"];

/** 把设置写入 document 根元素的 CSS 变量，编辑器样式直接读取 */
export function applySettings(s: Settings) {
  // 先铺主题底色，下面的自定义样式会覆盖同名变量
  applyTheme(s.theme);
  const root = document.documentElement;
  root.style.setProperty("--editor-font-size", `${s.fontSize}px`);
  root.style.setProperty("--editor-line-height", String(s.lineHeight));

  for (const key of Object.keys(VAR_PREFIX) as StyleKey[]) {
    const rule = s.styles[key];
    const p = VAR_PREFIX[key];
    if (rule.color) {
      root.style.setProperty(`${p}-color`, rule.color);
    } else if (THEME_COLORED.includes(key)) {
      // 主题已经给标题配好颜色，这里不能覆盖成 inherit
    } else {
      root.style.setProperty(`${p}-color`, "inherit");
    }
    root.style.setProperty(`${p}-font`, rule.fontFamily || "inherit");
    root.style.setProperty(`${p}-scale`, String(rule.scale || 1));
    root.style.setProperty(`${p}-weight`, rule.bold ? "700" : "inherit");
    root.style.setProperty(`${p}-style`, rule.italic ? "italic" : "inherit");
  }
}

// ---------------------------------------------------------------------------
// 持久化
// ---------------------------------------------------------------------------

/** 从后端读取设置（失败返回默认值） */
export async function loadSettings(): Promise<Settings> {
  try {
    const raw = await api.loadSettings();
    return normalizeSettings(raw);
  } catch {
    return defaultSettings();
  }
}

/** 保存到后端 */
export async function saveSettings(s: Settings): Promise<void> {
  await api.saveSettings(s as unknown as Record<string, unknown>);
}

// ---------------------------------------------------------------------------
// 快捷键解析
// ---------------------------------------------------------------------------

/** 解析 "Ctrl+Shift+N" → 修饰键与主键 */
export function parseShortcut(combo: string): {
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  key: string;
} | null {
  const parts = combo
    .split("+")
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean);
  if (parts.length === 0) return null;
  const key = parts[parts.length - 1];
  return {
    ctrl: parts.includes("ctrl") || parts.includes("cmd") || parts.includes("meta"),
    shift: parts.includes("shift"),
    alt: parts.includes("alt") || parts.includes("option"),
    key,
  };
}

/** 把键盘事件匹配为某个动作（返回动作名或 null） */
export function matchShortcut(
  e: KeyboardEvent,
  shortcuts: Record<ShortcutAction, string>,
): ShortcutAction | null {
  const key = e.key.toLowerCase();
  for (const action of Object.keys(shortcuts) as ShortcutAction[]) {
    const parsed = parseShortcut(shortcuts[action]);
    if (!parsed) continue;
    // 比较时把 ctrl/meta 视为同一类（macOS 的 Cmd）
    const ctrl = e.ctrlKey || e.metaKey;
    if (
      ctrl === parsed.ctrl &&
      e.shiftKey === parsed.shift &&
      e.altKey === parsed.alt &&
      key === parsed.key
    ) {
      return action;
    }
  }
  return null;
}

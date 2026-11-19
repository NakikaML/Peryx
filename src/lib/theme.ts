/**
 * 主题预设。
 *
 * 每个预设就是一组 CSS 变量，应用时写到 documentElement 上，
 * 覆盖 global.css 里 `:root` 的默认值。
 *
 * 默认预设按用户 Obsidian 的实际配置还原：
 * AnuPpuccin 主题 + Catppuccin Latte 配色 + 18px 正文。
 */

export interface ThemeVars {
  bg: string;
  bgPanel: string;
  bgEditor: string;
  bgElevated: string;
  fg: string;
  fgMuted: string;
  fgFaint: string;
  border: string;
  borderStrong: string;
  accent: string;
  accentSoft: string;
  accentInk: string;
  danger: string;
  selection: string;
  activeLine: string;
  codeBg: string;
  codeFg: string;
  quoteBorder: string;
  syntaxHeading: string;
  syntaxString: string;
  syntaxKeyword: string;
  syntaxNumber: string;
  /** 标题配色（H1–H3），留空表示跟随强调色 */
  headingColors?: [string, string, string];
}

export interface ThemePreset {
  id: string;
  name: string;
  /** 一句话说明 */
  hint: string;
  /** 是否深色（用于在选择卡上标注） */
  dark: boolean;
  /** 选中该主题时建议的字号与行高 */
  fontSize?: number;
  lineHeight?: number;
  vars: ThemeVars;
}

/**
 * Catppuccin Latte（AnuPpuccin 的浅色配色）
 * 参考 https://catppuccin.com/palette
 */
const LATTE: ThemeVars = {
  bg: "#eff1f5",
  bgPanel: "#e6e9ef",
  bgEditor: "#eff1f5",
  bgElevated: "#ffffff",
  fg: "#4c4f69",
  fgMuted: "#6c6f85",
  fgFaint: "#9ca0b0",
  border: "#dce0e8",
  borderStrong: "#ccd0da",
  accent: "#179299",
  accentSoft: "rgba(23, 146, 153, 0.12)",
  accentInk: "#0f6e74",
  danger: "#d20f39",
  selection: "rgba(23, 146, 153, 0.2)",
  activeLine: "rgba(23, 146, 153, 0.06)",
  codeBg: "#e6e9ef",
  codeFg: "#fe640b",
  quoteBorder: "#bcc0cc",
  syntaxHeading: "#179299",
  syntaxString: "#40a02b",
  syntaxKeyword: "#8839ef",
  syntaxNumber: "#fe640b",
  headingColors: ["#179299", "#7287fd", "#df8e1d"],
};

/** Catppuccin Mocha（对应 AnuPpuccin 深色） */
const MOCHA: ThemeVars = {
  bg: "#1e1e2e",
  bgPanel: "#181825",
  bgEditor: "#1e1e2e",
  bgElevated: "#313244",
  fg: "#cdd6f4",
  fgMuted: "#a6adc8",
  fgFaint: "#6c7086",
  border: "#313244",
  borderStrong: "#45475a",
  accent: "#94e2d5",
  accentSoft: "rgba(148, 226, 213, 0.14)",
  accentInk: "#89dceb",
  danger: "#f38ba8",
  selection: "rgba(148, 226, 213, 0.22)",
  activeLine: "rgba(148, 226, 213, 0.06)",
  codeBg: "#181825",
  codeFg: "#fab387",
  quoteBorder: "#585b70",
  syntaxHeading: "#94e2d5",
  syntaxString: "#a6e3a1",
  syntaxKeyword: "#cba6f7",
  syntaxNumber: "#fab387",
  headingColors: ["#94e2d5", "#b4befe", "#f9e2af"],
};

/** Solarized Light（护眼） */
const SOLARIZED: ThemeVars = {
  bg: "#fdf6e3",
  bgPanel: "#eee8d5",
  bgEditor: "#fdf6e3",
  bgElevated: "#fffbf0",
  fg: "#586e75",
  fgMuted: "#657b83",
  fgFaint: "#93a1a1",
  border: "#e6dfc8",
  borderStrong: "#d3cbb0",
  accent: "#268bd2",
  accentSoft: "rgba(38, 139, 210, 0.1)",
  accentInk: "#1c6a9e",
  danger: "#dc322f",
  selection: "rgba(38, 139, 210, 0.18)",
  activeLine: "rgba(38, 139, 210, 0.05)",
  codeBg: "#eee8d5",
  codeFg: "#cb4b16",
  quoteBorder: "#d3cbb0",
  syntaxHeading: "#268bd2",
  syntaxString: "#859900",
  syntaxKeyword: "#6c71c4",
  syntaxNumber: "#cb4b16",
  headingColors: ["#268bd2", "#6c71c4", "#b58900"],
};

/** 极简纸白 */
const PAPER: ThemeVars = {
  bg: "#ffffff",
  bgPanel: "#f6f8fa",
  bgEditor: "#ffffff",
  bgElevated: "#ffffff",
  fg: "#1f2328",
  fgMuted: "#59636e",
  fgFaint: "#8c959f",
  border: "#d8dee4",
  borderStrong: "#afb8c1",
  accent: "#0969da",
  accentSoft: "rgba(9, 105, 218, 0.09)",
  accentInk: "#0550ae",
  danger: "#cf222e",
  selection: "rgba(9, 105, 218, 0.16)",
  activeLine: "rgba(9, 105, 218, 0.04)",
  codeBg: "#f6f8fa",
  codeFg: "#cf222e",
  quoteBorder: "#d0d7de",
  syntaxHeading: "#0969da",
  syntaxString: "#0a3069",
  syntaxKeyword: "#8250df",
  syntaxNumber: "#0550ae",
  headingColors: ["#0969da", "#0550ae", "#1f2328"],
};

/** 墨绿（原本的暖米色基调） */
const MOSS: ThemeVars = {
  bg: "#f7f5f0",
  bgPanel: "#f1eee7",
  bgEditor: "#fdfcf9",
  bgElevated: "#ffffff",
  fg: "#2b2b2b",
  fgMuted: "#6b6b66",
  fgFaint: "#a5a29a",
  border: "#e2ddd3",
  borderStrong: "#d0c9bc",
  accent: "#2f6f6b",
  accentSoft: "rgba(47, 111, 107, 0.1)",
  accentInk: "#245652",
  danger: "#b8493c",
  selection: "rgba(47, 111, 107, 0.18)",
  activeLine: "rgba(47, 111, 107, 0.045)",
  codeBg: "#f2efe9",
  codeFg: "#8a4b2a",
  quoteBorder: "#c9bfa9",
  syntaxHeading: "#2f6f6b",
  syntaxString: "#8a4b2a",
  syntaxKeyword: "#6a5acd",
  syntaxNumber: "#b8860b",
  headingColors: ["#2f6f6b", "#2f6f6b", "#2f6f6b"],
};

export const THEME_PRESETS: ThemePreset[] = [
  {
    id: "obsidian",
    name: "Obsidian",
    hint: "AnuPpuccin · Catppuccin Latte（与你 Obsidian 一致）",
    dark: false,
    fontSize: 18,
    lineHeight: 1.75,
    vars: LATTE,
  },
  {
    id: "obsidian-dark",
    name: "Obsidian 深色",
    hint: "AnuPpuccin · Catppuccin Mocha",
    dark: true,
    fontSize: 18,
    lineHeight: 1.75,
    vars: MOCHA,
  },
  {
    id: "moss",
    name: "墨绿",
    hint: "栖知原本的暖米色基调",
    dark: false,
    fontSize: 16,
    lineHeight: 1.75,
    vars: MOSS,
  },
  {
    id: "solarized",
    name: "护眼",
    hint: "Solarized Light，长时间阅读不刺眼",
    dark: false,
    fontSize: 17,
    lineHeight: 1.8,
    vars: SOLARIZED,
  },
  {
    id: "paper",
    name: "纸白",
    hint: "纯白背景、蓝色强调，最干净",
    dark: false,
    fontSize: 16,
    lineHeight: 1.7,
    vars: PAPER,
  },
];

export const DEFAULT_THEME_ID = "obsidian";

export function getPreset(id: string | undefined): ThemePreset {
  return THEME_PRESETS.find((p) => p.id === id) ?? THEME_PRESETS[0];
}

/** CSS 变量名 → ThemeVars 字段 */
const VAR_MAP: [keyof ThemeVars, string][] = [
  ["bg", "--bg"],
  ["bgPanel", "--bg-panel"],
  ["bgEditor", "--bg-editor"],
  ["bgElevated", "--bg-elevated"],
  ["fg", "--fg"],
  ["fgMuted", "--fg-muted"],
  ["fgFaint", "--fg-faint"],
  ["border", "--border"],
  ["borderStrong", "--border-strong"],
  ["accent", "--accent"],
  ["accentSoft", "--accent-soft"],
  ["accentInk", "--accent-ink"],
  ["danger", "--danger"],
  ["selection", "--selection"],
  ["activeLine", "--active-line"],
  ["codeBg", "--code-bg"],
  ["codeFg", "--code-fg"],
  ["quoteBorder", "--quote-border"],
  ["syntaxHeading", "--syntax-heading"],
  ["syntaxString", "--syntax-string"],
  ["syntaxKeyword", "--syntax-keyword"],
  ["syntaxNumber", "--syntax-number"],
];

/** 把主题预设写进 documentElement 的 CSS 变量 */
export function applyTheme(id: string) {
  const preset = getPreset(id);
  const root = document.documentElement;
  for (const [key, cssVar] of VAR_MAP) {
    const value = preset.vars[key];
    if (typeof value === "string") root.style.setProperty(cssVar, value);
  }
  const heads = preset.vars.headingColors;
  if (heads) {
    root.style.setProperty("--md-h1-color", heads[0]);
    root.style.setProperty("--md-h2-color", heads[1]);
    root.style.setProperty("--md-h3-color", heads[2]);
  }
  // 深色主题需要通知浏览器（滚动条、表单控件跟着变）
  root.style.colorScheme = preset.dark ? "dark" : "light";
  root.dataset.theme = preset.dark ? "dark" : "light";
}

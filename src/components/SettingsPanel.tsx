/**
 * 设置面板：字体大小、各类 Markdown 样式、快捷键。
 *
 * 数学公式、代码块、表格不在可调范围内（用户明确说不支持）。
 */

import { useEffect, useMemo, useState } from "react";
import {
  DEFAULT_SHORTCUTS,
  SHORTCUT_LABELS,
  STYLE_LABELS,
  applySettings,
  saveSettings,
  type Settings,
  type ShortcutAction,
  type StyleKey,
  type StyleRule,
} from "@/lib/settings";
import { errText } from "@/lib/api";
import { DEFAULT_THEME_ID, THEME_PRESETS, getPreset } from "@/lib/theme";
import { useStore } from "@/stores/app";

interface Props {
  settings: Settings;
  onChange: (next: Settings) => void;
  onClose: () => void;
}

type Tab = "theme" | "keys";

/** 字体候选（中西文各给几个稳妥的） */
const FONT_OPTIONS = [
  { value: "", label: "默认" },
  { value: '"Segoe UI", system-ui, sans-serif', label: "无衬线（Segoe UI）" },
  { value: '"Microsoft YaHei", "PingFang SC", sans-serif', label: "微软雅黑" },
  { value: '"SimSun", "Songti SC", serif', label: "宋体" },
  { value: '"Georgia", "Times New Roman", serif', label: "Georgia" },
  { value: '"Consolas", "Courier New", monospace', label: "等宽 Consolas" },
];

/** 键盘事件 → "Ctrl+Shift+N" 这样的字符串 */
function comboFromEvent(e: KeyboardEvent): string | null {
  const mods: string[] = [];
  if (e.ctrlKey || e.metaKey) mods.push("Ctrl");
  if (e.shiftKey) mods.push("Shift");
  if (e.altKey) mods.push("Alt");

  const key = e.key;
  // 只按修饰键时不算完整组合
  if (["Control", "Shift", "Alt", "Meta", "OS"].includes(key)) return null;
  // 单独按 Esc 取消录制
  if (key === "Escape") return "";
  let main = key;
  if (key === " ") main = "Space";
  else if (key.length === 1) main = key.toUpperCase();
  if (mods.length === 0) return null; // 侧边栏快捷键至少需要 Alt/Ctrl
  return [...mods, main].join("+");
}

/** 设置窗口的尺寸范围 */
const MIN_W = 560;
const MIN_H = 380;
const DEFAULT_SIZE = { w: 860, h: 620 };
const SIZE_KEY = "peryx.settings.size";

/** 记住上次调整过的窗口大小 */
function loadSize(): { w: number; h: number } {
  try {
    const raw = localStorage.getItem(SIZE_KEY);
    if (!raw) return DEFAULT_SIZE;
    const s = JSON.parse(raw) as { w?: number; h?: number };
    return {
      w: Math.max(MIN_W, Math.min(Math.round(s.w ?? DEFAULT_SIZE.w), 2000)),
      h: Math.max(MIN_H, Math.min(Math.round(s.h ?? DEFAULT_SIZE.h), 1600)),
    };
  } catch {
    return DEFAULT_SIZE;
  }
}

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "theme", label: "外观", icon: "🎨" },
  { id: "keys", label: "快捷键", icon: "⌨" },
];

export function SettingsPanel({ settings, onChange, onClose }: Props) {
  const [tab, setTab] = useState<Tab>("theme");
  const [draft, setDraft] = useState<Settings>(settings);
  /** 正在录制快捷键的动作 */
  const [recording, setRecording] = useState<ShortcutAction | null>(null);
  /** 窗口尺寸（右下角可拖动调整） */
  const [size, setSize] = useState(loadSize);
  const toast = useStore((s) => s.toast);

  /** 右下角拖动调整窗口大小 */
  const beginResize = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startY = e.clientY;
    const startW = size.w;
    const startH = size.h;

    const onMove = (ev: MouseEvent) => {
      setSize({
        w: Math.max(MIN_W, Math.min(startW + (ev.clientX - startX), window.innerWidth - 40)),
        h: Math.max(MIN_H, Math.min(startH + (ev.clientY - startY), window.innerHeight - 40)),
      });
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      // 记住尺寸
      setSize((cur) => {
        try {
          localStorage.setItem(SIZE_KEY, JSON.stringify(cur));
        } catch {
          /* 无痕模式等写不进去就算了 */
        }
        return cur;
      });
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  // 打开时把当前设置复制成草稿；实时预览样式
  useEffect(() => {
    applySettings(draft);
  }, [draft]);

  // 录制快捷键
  useEffect(() => {
    if (!recording) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const combo = comboFromEvent(e);
      if (combo === null) return;
      if (combo === "") {
        setRecording(null);
        return;
      }
      update({ shortcuts: { ...draft.shortcuts, [recording]: combo } });
      setRecording(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [recording, draft]);

  const update = (patch: Partial<Settings>) => {
    setDraft((d) => {
      const next = { ...d, ...patch };
      onChange(next);
      return next;
    });
  };

  const updateStyle = (key: StyleKey, patch: Partial<StyleRule>) => {
    const rule = { ...draft.styles[key], ...patch };
    update({ styles: { ...draft.styles, [key]: rule } });
  };

  const resetCurrentTab = () => {
    if (tab === "theme") {
      // 主题页包含字号、行高、元素样式，一并恢复
      const styles = {} as typeof draft.styles;
      for (const { key } of STYLE_LABELS) {
        styles[key] = { color: "", fontFamily: "", scale: 1, bold: false, italic: false };
      }
      const preset = getPreset(DEFAULT_THEME_ID);
      update({
        theme: DEFAULT_THEME_ID,
        fontSize: preset.fontSize ?? 18,
        lineHeight: preset.lineHeight ?? 1.75,
        styles,
      });
      toast("已恢复默认主题与样式", "success");
    } else {
      update({ shortcuts: { ...DEFAULT_SHORTCUTS } });
      toast("快捷键已恢复默认", "success");
    }
  };

  /** 快捷键冲突检测 */
  const conflicts = useMemo(() => {
    const seen = new Map<string, ShortcutAction[]>();
    for (const action of Object.keys(draft.shortcuts) as ShortcutAction[]) {
      const combo = draft.shortcuts[action].toLowerCase();
      const list = seen.get(combo) ?? [];
      list.push(action);
      seen.set(combo, list);
    }
    const bad = new Map<ShortcutAction, ShortcutAction[]>();
    for (const [, list] of seen) {
      if (list.length > 1) for (const a of list) bad.set(a, list.filter((x) => x !== a));
    }
    return bad;
  }, [draft.shortcuts]);

  const persist = async () => {
    try {
      await saveSettings(draft);
      toast("设置已保存", "success");
      onClose();
    } catch (e) {
      toast(errText(e), "error");
    }
  };

  return (
    <div className="cmdk-mask" onMouseDown={onClose}>
      <div
        className="settings"
        style={{ width: size.w, height: size.h }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="settings-head">
          <span className="settings-title">设置</span>
          <span className="settings-spacer" />
          <button className="settings-close" onClick={onClose} title="关闭（Esc）">
            ✕
          </button>
        </div>

        <div className="settings-main">
          {/* 左侧导航（Obsidian 式） */}
          <nav className="settings-nav">
            {TABS.map((t) => (
              <button
                key={t.id}
                data-settings-tab={t.id}
                className={`settings-nav-item ${tab === t.id ? "active" : ""}`}
                onClick={() => setTab(t.id)}
              >
                <span className="settings-nav-icon">{t.icon}</span>
                {t.label}
              </button>
            ))}
          </nav>

          {/* 右侧内容 */}
          <div className="settings-content">
            <div className="settings-pane-title">{TABS.find((t) => t.id === tab)?.label}</div>
            <div className="settings-body">
              {tab === "theme" && (
            <div className="settings-section">
              <div className="settings-note" style={{ marginTop: 0 }}>
                选一个预设作为整体配色；下面可以再微调字号、行高和单个元素的颜色与字体。
                切换主题时，没手动改过的元素会跟着换色。
              </div>

              <div className="theme-grid">
                {THEME_PRESETS.map((p) => {
                  const selected = draft.theme === p.id;
                  return (
                    <button
                      key={p.id}
                      data-theme-id={p.id}
                      className={`theme-card ${selected ? "selected" : ""}`}
                      onClick={() => {
                        /*
                         * 切换主题 = 换一套基础样式。
                         * 把元素上手动改过的颜色清掉，才会跟着新主题走
                         * （字体、缩放、粗细这些不属于配色的保留）。
                         */
                        const styles = {} as typeof draft.styles;
                        for (const { key } of STYLE_LABELS) {
                          styles[key] = { ...draft.styles[key], color: "" };
                        }
                        update({
                          theme: p.id,
                          ...(p.fontSize ? { fontSize: p.fontSize } : {}),
                          ...(p.lineHeight ? { lineHeight: p.lineHeight } : {}),
                          styles,
                        });
                      }}
                    >
                      <span className="theme-preview" aria-hidden="true">
                        <span
                          className="theme-preview-side"
                          style={{ background: p.vars.bgPanel, borderColor: p.vars.border }}
                        />
                        <span
                          className="theme-preview-main"
                          style={{ background: p.vars.bgEditor }}
                        >
                          <span
                            className="theme-preview-line"
                            style={{ background: p.vars.fg, width: "70%" }}
                          />
                          <span
                            className="theme-preview-line"
                            style={{ background: p.vars.fgMuted, width: "88%" }}
                          />
                          <span
                            className="theme-preview-line"
                            style={{ background: p.vars.accent, width: "45%" }}
                          />
                        </span>
                      </span>
                      <span className="theme-meta">
                        <span className="theme-name">
                          {p.name}
                          {p.dark && <span className="theme-badge">深色</span>}
                          {selected && <span className="theme-check">✓</span>}
                        </span>
                        <span className="theme-hint">{p.hint}</span>
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className="settings-preview" style={{ marginTop: 12 }}>
                <div className="settings-preview-title">
                  预览 · {getPreset(draft.theme).name}
                </div>
                <div
                  style={{
                    background: getPreset(draft.theme).vars.bgEditor,
                    color: getPreset(draft.theme).vars.fg,
                    border: `1px solid ${getPreset(draft.theme).vars.border}`,
                    borderRadius: 8,
                    padding: "12px 14px",
                    fontSize: draft.fontSize,
                    lineHeight: draft.lineHeight,
                  }}
                >
                  <div
                    style={{
                      color: getPreset(draft.theme).vars.headingColors?.[0] ?? getPreset(draft.theme).vars.accent,
                      fontWeight: 700,
                      fontSize: "1.25em",
                      marginBottom: 6,
                    }}
                  >
                    一级标题
                  </div>
                  <div style={{ marginBottom: 6 }}>正文文字，用来感受配色是否舒服。</div>
                  <span
                    style={{
                      color: getPreset(draft.theme).vars.accent,
                      background: getPreset(draft.theme).vars.accentSoft,
                      padding: "1px 8px",
                      borderRadius: 10,
                      fontSize: "0.86em",
                    }}
                  >
                    标签
                  </span>
                </div>
              </div>

              {/* ---- 基础样式：字号与行高 ---- */}
              <div className="settings-subtitle">基础样式</div>

              <label className="settings-row">
                <span className="settings-label">正文字号</span>
                <input
                  type="range"
                  min={12}
                  max={26}
                  step={1}
                  value={draft.fontSize}
                  onChange={(e) => update({ fontSize: Number(e.target.value) })}
                />
                <span className="settings-value">{draft.fontSize} px</span>
              </label>

              <label className="settings-row">
                <span className="settings-label">行高</span>
                <input
                  type="range"
                  min={1.2}
                  max={2.6}
                  step={0.05}
                  value={draft.lineHeight}
                  onChange={(e) => update({ lineHeight: Number(e.target.value) })}
                />
                <span className="settings-value">{draft.lineHeight.toFixed(2)}</span>
              </label>

              <div className="settings-note">
                数学公式、代码块、表格的字号不在此调整范围内。
              </div>

              {/* ---- 元素样式 ---- */}
              <div className="settings-subtitle">元素样式</div>
              <div className="settings-note" style={{ marginTop: 0 }}>
                颜色留空表示沿用主题；缩放 1 表示不缩放。
              </div>
              {STYLE_LABELS.map(({ key, label }) => {
                const rule = draft.styles[key];
                // 没自定义颜色时，色块显示当前主题给该元素的颜色
                const themeColor = getPreset(draft.theme).elementColors?.[key];
                const shownColor = rule.color || themeColor || "#2f6f6b";
                return (
                  <div className="style-card" key={key}>
                    <div className="style-card-head">{label}</div>
                    <div className="style-row">
                      <span className="style-label">颜色</span>
                      <input
                        type="color"
                        className="style-color"
                        data-style-key={key}
                        value={shownColor}
                        onChange={(e) => updateStyle(key, { color: e.target.value })}
                      />
                      <button
                        className="style-clear"
                        title="恢复该主题的默认颜色"
                        onClick={() => updateStyle(key, { color: "" })}
                      >
                        默认
                      </button>
                      <span className="style-label">字体</span>
                      <select
                        className="style-select"
                        value={rule.fontFamily}
                        onChange={(e) => updateStyle(key, { fontFamily: e.target.value })}
                      >
                        {FONT_OPTIONS.map((f) => (
                          <option key={f.value} value={f.value}>
                            {f.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="style-row">
                      <span className="style-label">缩放</span>
                      <input
                        type="range"
                        min={0.6}
                        max={2}
                        step={0.05}
                        value={rule.scale}
                        onChange={(e) => updateStyle(key, { scale: Number(e.target.value) })}
                      />
                      <span className="settings-value">{rule.scale.toFixed(2)}×</span>
                      <label className="style-check">
                        <input
                          type="checkbox"
                          checked={rule.bold}
                          onChange={(e) => updateStyle(key, { bold: e.target.checked })}
                        />
                        加粗
                      </label>
                      <label className="style-check">
                        <input
                          type="checkbox"
                          checked={rule.italic}
                          onChange={(e) => updateStyle(key, { italic: e.target.checked })}
                        />
                        斜体
                      </label>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {tab === "keys" && (
            <div className="settings-section">
              <div className="settings-note" style={{ marginTop: 0 }}>
                点击右侧组合键后按下新快捷键；Esc 取消。至少需要 Ctrl 或 Alt。
              </div>
              {Object.keys(SHORTCUT_LABELS).map((k) => {
                const action = k as ShortcutAction;
                const isRec = recording === action;
                const conflict = conflicts.get(action);
                return (
                  <div className="shortcut-row" key={action}>
                    <span className="shortcut-label">{SHORTCUT_LABELS[action]}</span>
                    {conflict && (
                      <span className="shortcut-warn" title="与其他快捷键冲突">
                        冲突
                      </span>
                    )}
                    <button
                      className={`shortcut-key ${isRec ? "recording" : ""}`}
                      onClick={() => setRecording(isRec ? null : action)}
                    >
                      {isRec ? "按下组合键…" : draft.shortcuts[action]}
                    </button>
                    <button
                      className="shortcut-reset"
                      title="恢复该项默认值"
                      onClick={() =>
                        update({
                          shortcuts: { ...draft.shortcuts, [action]: DEFAULT_SHORTCUTS[action] },
                        })
                      }
                    >
                      ↺
                    </button>
                  </div>
                );
              })}
            </div>
          )}
            </div>
          </div>
        </div>

        {/* 右下角拖拽调整窗口大小 */}
        <div
          className="settings-resize"
          title="拖动调整大小"
          onMouseDown={beginResize}
        />

        <div className="settings-foot">
          <button className="btn-ghost" onClick={resetCurrentTab}>
            恢复本页默认
          </button>
          <span className="settings-spacer" />
          <button className="btn-ghost" onClick={onClose}>
            取消
          </button>
          <button className="btn-primary" onClick={() => void persist()}>
            保存
          </button>
        </div>
      </div>
    </div>
  );
}

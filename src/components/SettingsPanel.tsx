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
import { useStore } from "@/stores/app";

interface Props {
  settings: Settings;
  onChange: (next: Settings) => void;
  onClose: () => void;
}

type Tab = "font" | "style" | "keys";

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

export function SettingsPanel({ settings, onChange, onClose }: Props) {
  const [tab, setTab] = useState<Tab>("font");
  const [draft, setDraft] = useState<Settings>(settings);
  /** 正在录制快捷键的动作 */
  const [recording, setRecording] = useState<ShortcutAction | null>(null);
  const toast = useStore((s) => s.toast);

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
    if (tab === "keys") {
      update({ shortcuts: { ...DEFAULT_SHORTCUTS } });
      toast("快捷键已恢复默认", "success");
    } else if (tab === "style") {
      const styles = { ...draft.styles };
      for (const { key } of STYLE_LABELS) {
        styles[key] = { color: "", fontFamily: "", scale: 1, bold: false, italic: false };
      }
      update({ styles });
      toast("样式已恢复默认", "success");
    } else {
      update({ fontSize: 16, lineHeight: 1.75 });
      toast("字号已恢复默认", "success");
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
      <div className="settings" onMouseDown={(e) => e.stopPropagation()}>
        <div className="settings-head">
          <span className="settings-title">设置</span>
          <div className="settings-tabs">
            <button className={`settings-tab ${tab === "font" ? "active" : ""}`} onClick={() => setTab("font")}>
              字号
            </button>
            <button className={`settings-tab ${tab === "style" ? "active" : ""}`} onClick={() => setTab("style")}>
              样式
            </button>
            <button className={`settings-tab ${tab === "keys" ? "active" : ""}`} onClick={() => setTab("keys")}>
              快捷键
            </button>
          </div>
          <button className="settings-close" onClick={onClose} title="关闭（Esc）">
            ✕
          </button>
        </div>

        <div className="settings-body">
          {tab === "font" && (
            <div className="settings-section">
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

              <div className="settings-preview">
                <div className="settings-preview-title">预览</div>
                <div style={{ fontSize: draft.fontSize, lineHeight: draft.lineHeight }}>
                  <p style={{ margin: "0 0 6px" }}>这是一段正文，用来感受字号与行高。</p>
                  <p style={{ margin: 0, fontWeight: 700 }}>加粗的文字</p>
                  <p style={{ margin: 0, fontStyle: "italic" }}>斜体的文字</p>
                </div>
              </div>

              <div className="settings-note">
                数学公式、代码块、表格的字号不在此调整范围内。
              </div>
            </div>
          )}

          {tab === "style" && (
            <div className="settings-section">
              <div className="settings-note" style={{ marginTop: 0 }}>
                颜色留空表示沿用主题；缩放 1 表示不缩放。
              </div>
              {STYLE_LABELS.map(({ key, label }) => {
                const rule = draft.styles[key];
                return (
                  <div className="style-card" key={key}>
                    <div className="style-card-head">{label}</div>
                    <div className="style-row">
                      <span className="style-label">颜色</span>
                      <input
                        type="color"
                        className="style-color"
                        value={rule.color || "#2f6f6b"}
                        onChange={(e) => updateStyle(key, { color: e.target.value })}
                      />
                      <button
                        className="style-clear"
                        title="恢复默认颜色"
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

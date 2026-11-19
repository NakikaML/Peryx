/** CodeMirror 6 Markdown 编辑器 */

import { useEffect, useImperativeHandle, useRef, forwardRef } from "react";
import { EditorState, Compartment } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import {
  EditorView,
  keymap,
  drawSelection,
  dropCursor,
  rectangularSelection,
  crosshairCursor,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  placeholder as cmPlaceholder,
} from "@codemirror/view";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import {
  bracketMatching,
  indentOnInput,
  syntaxHighlighting,
  HighlightStyle,
  foldGutter,
  foldKeymap,
} from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";

import { livePreview, setLivePreview, livePreviewEnabled } from "./livePreview";
import { wikiCompletion } from "./wikiComplete";
import { linkClickHandler, linkCursorHandler } from "./linkHandler";
import { peryxTheme } from "./theme";
import type { EditorMode } from "@/lib/types";

/** 通过 ref 暴露给工具栏使用的编辑器能力 */
export interface EditorHandle {
  view: EditorView | null;
  focus: () => void;
}

interface Props {
  docPath: string;
  value: string;
  mode: EditorMode;
  showLineNumbers: boolean;
  onChange: (value: string) => void;
  onSave: () => void;
  onCursor?: (line: number, col: number) => void;
}

/** 源码模式语法高亮 */
const sourceHighlight = syntaxHighlighting(
  HighlightStyle.define([
    { tag: t.heading, fontWeight: "600", color: "var(--syntax-heading)" },
    { tag: t.strong, fontWeight: "700" },
    { tag: t.emphasis, fontStyle: "italic" },
    { tag: t.strikethrough, textDecoration: "line-through" },
    { tag: t.link, color: "var(--accent)" },
    { tag: t.url, color: "var(--accent)" },
    { tag: t.monospace, color: "var(--code-fg)", backgroundColor: "var(--code-bg)" },
    { tag: t.quote, color: "var(--fg-muted)" },
    { tag: t.list, color: "var(--syntax-keyword)" },
    { tag: t.contentSeparator, color: "var(--fg-faint)" },
    // 代码块内的具体语言着色（由 lang-markdown 解析 fenced code 后产生）
    { tag: t.keyword, color: "var(--syntax-keyword)" },
    { tag: t.string, color: "var(--syntax-string)" },
    { tag: t.number, color: "var(--syntax-number)" },
    { tag: t.comment, color: "var(--fg-faint)", fontStyle: "italic" },
    { tag: t.function(t.variableName), color: "var(--syntax-heading)" },
    { tag: t.definition(t.variableName), color: "var(--accent-ink)" },
    { tag: t.operator, color: "var(--fg-muted)" },
    { tag: t.punctuation, color: "var(--fg-faint)" },
  ]),
);

export const MarkdownEditor = forwardRef<EditorHandle, Props>(function MarkdownEditor(
  { docPath, value, mode, showLineNumbers, onChange, onSave, onCursor },
  ref,
) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  // 这些 compartment 允许运行期热切换而不重建编辑器
  const modeCompartment = useRef(new Compartment());
  const gutterCompartment = useRef(new Compartment());
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  const onCursorRef = useRef(onCursor);
  onChangeRef.current = onChange;
  onSaveRef.current = onSave;
  onCursorRef.current = onCursor;

  useImperativeHandle(ref, () => ({
    get view() {
      return viewRef.current;
    },
    focus: () => viewRef.current?.focus(),
  }));

  // 初始化编辑器（仅在挂载时创建一次）
  useEffect(() => {
    if (!hostRef.current) return;

    // 两种模式都启用语法高亮（让代码块和列表更好看），
    // 区别只在于 livePreview 开关是否打开。
    const modeExtensions = (): Extension => [
      sourceHighlight,
      livePreview,
      linkClickHandler,
      linkCursorHandler,
    ];

    const state = EditorState.create({
      doc: value,
      extensions: [
        gutterCompartment.current.of(showLineNumbers ? [lineNumbers(), foldGutter()] : []),
        highlightActiveLineGutter(),
        history(),
        drawSelection(),
        dropCursor(),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        wikiCompletion,
        rectangularSelection(),
        crosshairCursor(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        EditorView.lineWrapping,
        markdown({ base: markdownLanguage, addKeymap: true, codeLanguages: languages }),
        cmPlaceholder("开始书写你的笔记…  支持 Markdown、公式 $$E=mc^2$$、代码块"),
        livePreviewEnabled.init(() => mode === "live"),
        modeCompartment.current.of(modeExtensions()),
        keymap.of([
          {
            key: "Mod-s",
            preventDefault: true,
            run: () => {
              onSaveRef.current();
              return true;
            },
          },
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...searchKeymap,
          ...historyKeymap,
          ...foldKeymap,
          indentWithTab,
        ]),
        peryxTheme,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onChangeRef.current(update.state.doc.toString());
          }
          if (update.selectionSet || update.docChanged) {
            const head = update.state.selection.main.head;
            const line = update.state.doc.lineAt(head);
            onCursorRef.current?.(line.number, head - line.from + 1);
          }
        }),
      ],
    });

    const view = new EditorView({ state, parent: hostRef.current });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 切换文件：整体替换文档内容（保留撤销历史会被清空，符合预期）
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== value) {
      view.dispatch({
        changes: { from: 0, to: current.length, insert: value },
        selection: { anchor: 0 },
        scrollIntoView: true,
      });
    }
  }, [docPath]);

  // 外部内容变化（如切换文件时 store 已更新）
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    if (view.state.doc.toString() === value) return;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
  }, [value]);

  // 模式切换：高亮始终开启，只切换 livePreview 开关
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const ext: Extension = [sourceHighlight, livePreview, linkClickHandler, linkCursorHandler];
    view.dispatch({
      effects: [
        modeCompartment.current.reconfigure(ext),
        setLivePreview.of(mode === "live"),
      ],
    });
  }, [mode]);

  // 行号开关
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: gutterCompartment.current.reconfigure(showLineNumbers ? [lineNumbers(), foldGutter()] : []),
    });
  }, [showLineNumbers]);

  return <div ref={hostRef} className="editor-host" />;
});

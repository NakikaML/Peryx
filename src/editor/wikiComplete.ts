/**
 * `[[` 双链自动补全。
 *
 * 输入 `[[` 后弹出笔记列表；选中后补成 `[[标题]]` 并把光标放到 `]]` 之后。
 * 若用户已经手打了 `]]`，则不重复补。
 */

import { autocompletion } from "@codemirror/autocomplete";
import type {
  Completion,
  CompletionContext,
  CompletionResult,
} from "@codemirror/autocomplete";
import type { EditorView } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import { allNoteMetas } from "@/lib/linkCache";

/** 最多展示多少条候选 */
const MAX_OPTIONS = 60;

/**
 * 供补全使用的「插入 `]]` 并定位光标」函数。
 *
 * 判断 `to` 之后是否已经存在 `]]`（编辑器装了 closeBrackets，
 * 输入 `[[` 会自动补出 `]]`，光标停在中间）：
 * - 有 → 只插入名字，光标移到已有 `]]` 之后
 * - 无 → 插入名字 + `]]`，光标停在 `]]` 之后
 */
function makeApply(title: string) {
  return (view: EditorView, _completion: Completion, from: number, to: number) => {
    const doc = view.state.doc;
    const after = doc.sliceString(to, Math.min(to + 2, doc.length));
    const hasClose = after.startsWith("]]");
    const insert = hasClose ? title : `${title}]]`;
    const anchor = from + insert.length + (hasClose ? 2 : 0);
    view.dispatch({
      changes: { from, to, insert },
      selection: { anchor },
    });
  };
}

/**
 * 双链补全源：只在光标前是未闭合的 `[[xxx` 时触发。
 *
 * 注意排除：
 * - 跨行（`\n`）
 * - 已经出现 `]` 的情况（说明这条链接已写完）
 * - 已经写了 `|` 之后的部分（那是别名，不再补目标）
 */
export function wikiLinkCompletion(context: CompletionContext): CompletionResult | null {
  const before = context.matchBefore(/\[\[[^[\]\n|]*$/);
  if (!before) return null;

  // `from` 指向 `[[` 之后，也就是被替换文本的起点
  const from = before.from + 2;
  const typed = before.text.slice(2).trim();
  const lower = typed.toLowerCase();

  const notes = allNoteMetas();
  type Scored = { note: (typeof notes)[number]; score: number };
  const scored: Scored[] = [];

  for (const n of notes) {
    const title = n.title.toLowerCase();
    const path = n.path.toLowerCase();
    let score: number;
    if (!lower) {
      score = 1;
    } else if (title === lower) {
      score = 1000;
    } else if (title.startsWith(lower)) {
      score = 800;
    } else if (title.includes(lower)) {
      score = 600;
    } else if (path.includes(lower)) {
      score = 400;
    } else {
      continue;
    }
    scored.push({ note: n, score });
  }

  if (scored.length === 0) return null;

  scored.sort((a, b) => b.score - a.score || a.note.path.localeCompare(b.note.path));

  const options: Completion[] = scored.slice(0, MAX_OPTIONS).map(({ note }) => ({
    label: note.title,
    detail: note.path === `${note.title}.md` ? undefined : note.path,
    // 用标题补全；如果标题与文件名不同，用户多半想写文件名
    apply: makeApply(note.title),
    type: "text",
  }));

  return {
    from,
    options,
    // 自己完成过滤，避免 CodeMirror 再按 label 过滤掉路径命中项
    filter: false,
  };
}

/** 双链补全扩展 */
export const wikiCompletion: Extension = autocompletion({
  override: [wikiLinkCompletion],
  activateOnTyping: true,
  closeOnBlur: true,
  icons: false,
  maxRenderedOptions: 20,
});

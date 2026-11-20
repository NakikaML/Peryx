/**
 * YAML frontmatter（笔记属性）的解析与改写。
 *
 * 只覆盖 Obsidian 属性面板用到的子集，不追求完整 YAML：
 * - `key: 值`
 * - `key:` + 下面若干 `  - 值`（列表）
 * - `key: [a, b]`（内联列表）
 * - 字符串可带引号
 *
 * 设计原则：**没动过的行原样保留**，只替换需要改的那几行，
 * 避免把用户手写的 YAML 注释、格式洗掉。
 */

export type PropertyKind = "text" | "list" | "number" | "boolean" | "date";

export interface Property {
  /** 原始键名（保留大小写） */
  key: string;
  /** 文本值；列表用 values 存 */
  value: string;
  /** 列表型属性的条目 */
  values: string[];
  kind: PropertyKind;
  /** 在原文里的行范围（0-based，闭区间），用于原位替换 */
  startLine: number;
  endLine: number;
}

export interface Frontmatter {
  /** frontmatter 里的属性（保持原始顺序） */
  properties: Property[];
  /** frontmatter 结束行（`---` 那行的下一行在 body 里的下标）；没有 frontmatter 时为 0 */
  bodyStartLine: number;
  /** 是否真的存在 frontmatter */
  exists: boolean;
}

const FM_START = /^---\s*$/;
const FM_END = /^(---|\.\.\.)\s*$/;

/** 判断一行是否是列表项（`- 值`） */
function isListItem(line: string): boolean {
  return /^\s*-\s+/.test(line) || /^\s*-\s*$/.test(line);
}

/** 去掉列表项的 `-`、缩进和引号 */
function listItemValue(line: string): string {
  return unquote(line.replace(/^\s*-\s*/, "").trim());
}

function unquote(raw: string): string {
  let v = raw.trim();
  if (
    (v.startsWith('"') && v.endsWith('"') && v.length >= 2) ||
    (v.startsWith("'") && v.endsWith("'") && v.length >= 2)
  ) {
    v = v.slice(1, -1);
  }
  return v;
}

/** 猜类型：列表 / 数字 / 布尔 / 日期 / 文本 */
function inferKind(key: string, value: string, isList: boolean): PropertyKind {
  const k = key.toLowerCase();
  if (isList) return "list";
  if (k === "aliases" || k === "alias" || k === "tags" || k === "tag" || k === "cssclasses") {
    return "list";
  }
  if (/^-?\d+(\.\d+)?$/.test(value)) return "number";
  if (value === "true" || value === "false") return "boolean";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return "date";
  return "text";
}

/**
 * 解析 frontmatter。
 *
 * 返回的行号都是「相对整个文档的 0-based 行号」，
 * 这样后面的改写可以直接按行操作。
 */
export function parseFrontmatter(text: string): Frontmatter {
  const lines = text.split("\n");
  const empty: Frontmatter = { properties: [], bodyStartLine: 0, exists: false };
  if (lines.length === 0 || !FM_START.test(lines[0])) return empty;

  // 找结束行
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (FM_END.test(lines[i])) {
      end = i;
      break;
    }
  }
  if (end < 0) return empty; // 没闭合就当没有 frontmatter

  const properties: Property[] = [];
  let i = 1;
  while (i < end) {
    const line = lines[i];
    if (!line.trim() || line.trimStart().startsWith("#")) {
      i++;
      continue;
    }

    // 顶层键
    const m = /^([A-Za-z0-9_\u4e00-\u9fa5-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) {
      i++;
      continue;
    }
    const key = m[1];
    const rawValue = m[2].trim();
    const startLine = i;
    let endLine = i;
    let values: string[] = [];
    let value = "";

    // 内联列表：[a, b]
    if (rawValue.startsWith("[") && rawValue.endsWith("]")) {
      values = rawValue
        .slice(1, -1)
        .split(",")
        .map((s) => unquote(s))
        .filter((s) => s.length > 0);
      value = values.join(", ");
    } else if (rawValue !== "") {
      value = unquote(rawValue);
    } else {
      // 值在下面缩进的 `- 项` 里
      let j = i + 1;
      const collected: string[] = [];
      while (j < end) {
        if (isListItem(lines[j])) {
          const v = listItemValue(lines[j]);
          if (v) collected.push(v);
          j++;
          continue;
        }
        // 允许列表项之间夹空行
        if (!lines[j].trim()) {
          j++;
          continue;
        }
        break;
      }
      if (collected.length > 0) {
        values = collected;
        value = collected.join(", ");
        endLine = j - 1;
      } else {
        // 空值属性（`key:` 后面什么都没有）
        value = "";
        endLine = i;
      }
      i = endLine + 1;
      properties.push({
        key,
        value,
        values: values.length ? values : value ? [value] : [],
        kind: inferKind(key, value, values.length > 0),
        startLine,
        endLine,
      });
      continue;
    }

    i = endLine + 1;
    properties.push({
      key,
      value,
      values: values.length ? values : value ? [value] : [],
      kind: inferKind(key, value, values.length > 0),
      startLine,
      endLine,
    });
  }

  return { properties, bodyStartLine: end + 1, exists: true };
}

/** 取别名列表（`aliases` / `alias`） */
export function getAliases(text: string): string[] {
  const fm = parseFrontmatter(text);
  for (const p of fm.properties) {
    const k = p.key.toLowerCase();
    if (k === "aliases" || k === "alias") return p.values;
  }
  return [];
}

/** 取某个属性的值（列表返回 values） */
export function getProperty(text: string, key: string): Property | null {
  const fm = parseFrontmatter(text);
  return fm.properties.find((p) => p.key.toLowerCase() === key.toLowerCase()) ?? null;
}

/** 把属性渲染成 YAML 行 */
export function renderProperty(p: {
  key: string;
  kind: PropertyKind;
  value: string;
  values: string[];
}): string[] {
  const key = p.key.trim();
  if (p.kind === "list") {
    const list = p.values.filter((v) => v.trim().length > 0);
    if (list.length === 0) return [`${key}:`];
    if (list.length === 1) {
      // 单个值也写成列表，保持类型稳定
      return [`${key}:`, `  - ${list[0]}`];
    }
    return [`${key}:`, ...list.map((v) => `  - ${v}`)];
  }
  return [`${key}: ${p.value}`];
}

/**
 * 改/加/删一个属性，返回新的整篇文本。
 *
 * 已有 frontmatter → 只替换该属性占据的行；
 * 没有 frontmatter → 在文件开头插入一个。
 */
export function setProperty(
  text: string,
  key: string,
  next: { value?: string; values?: string[]; kind?: PropertyKind } | null,
): string {
  const lines = text.split("\n");
  const fm = parseFrontmatter(text);
  const k = key.trim();
  const lower = k.toLowerCase();

  // 删除
  if (next === null) {
    if (!fm.exists) return text;
    const prop = fm.properties.find((p) => p.key.toLowerCase() === lower);
    if (!prop) return text;
    lines.splice(prop.startLine, prop.endLine - prop.startLine + 1);
    // 删空了就一起去掉 frontmatter
    if (fm.properties.length === 1) {
      const endLine = fm.bodyStartLine - 1;
      lines.splice(0, endLine + 1);
      // 去掉紧随其后的空行
      if (lines[0] === "") lines.shift();
    }
    return lines.join("\n");
  }

  const kind = next.kind ?? "text";
  const rendered = renderProperty({
    key: k,
    kind,
    value: next.value ?? "",
    values: next.values ?? [],
  });

  if (!fm.exists) {
    // 新建 frontmatter
    const head = ["---", ...rendered, "---"];
    // 原文开头如果有空行先留着，避免吃掉
    return [...head, "", ...lines].join("\n");
  }

  const prop = fm.properties.find((p) => p.key.toLowerCase() === lower);
  if (prop) {
    lines.splice(prop.startLine, prop.endLine - prop.startLine + 1, ...rendered);
    return lines.join("\n");
  }

  // 追加到 frontmatter 末尾（最后一条属性之后）
  const insertAt =
    fm.properties.length > 0
      ? fm.properties[fm.properties.length - 1].endLine + 1
      : fm.bodyStartLine - 1;
  lines.splice(insertAt, 0, ...rendered);
  return lines.join("\n");
}

/** 当前文档是否已经有 frontmatter */
export function hasFrontmatter(text: string): boolean {
  return parseFrontmatter(text).exists;
}

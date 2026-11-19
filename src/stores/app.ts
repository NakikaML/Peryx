/** 全局状态（Zustand） */

import { create } from "zustand";
import { api, errText } from "@/lib/api";
import { clearLinkIndex, refreshLinkIndex } from "@/lib/linkCache";
import type {
  ChildrenMap,
  ContextHit,
  EditorMode,
  ExpandedMap,
  FileNode,
  LinkRef,
  NoteMeta,
  OpenNote,
  NoteTab,
  TagCount,
  VaultInfo,
} from "@/lib/types";

/** 去掉 `.md` 后缀得到标题 */
export function titleOf(path: string): string {
  const name = path.split("/").pop() ?? path;
  return name.replace(/\.md$/i, "");
}

/** 取父目录（根为 ""） */
export function parentOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i < 0 ? "" : path.slice(0, i);
}

interface Toast {
  id: number;
  kind: "info" | "error" | "success";
  text: string;
  /** 相同文本出现的次数（合并重复提示） */
  count: number;
}

interface AppStore {
  vault: VaultInfo | null;
  /** 最近打开过的笔记库路径 */
  recentVaults: string[];

  /** 目录树子节点缓存：key 为目录相对路径（根为 ""） */
  children: ChildrenMap;
  expanded: ExpandedMap;
  /** 当前选中的位置（笔记或文件夹的相对路径） */
  selectedPath: string | null;
  /** 当前选中的是文件夹 */
  selectedIsDir: boolean;

  note: OpenNote | null;
  /** 已打开的标签页（最近打开的在后） */
  tabs: NoteTab[];
  /** 分屏里打开的笔记路径，null 表示未分屏 */
  splitPath: string | null;
  /** 在分屏里打开笔记 */
  openInSplit: (path: string) => void;
  /** 关闭分屏 */
  closeSplit: () => void;
  /** 正在预览的图片（相对路径），null 表示未预览图片 */
  imagePreview: string | null;
  /** 打开图片预览（右侧编辑区显示图片） */
  showImage: (path: string) => void;
  mode: EditorMode;
  /** 侧边栏是否折叠 */
  sidebarOpen: boolean;
  /** 正在从磁盘读取笔记 */
  loadingNote: boolean;

  toasts: Toast[];

  // --- actions ---
  loadVault: () => Promise<void>;
  setVault: (v: VaultInfo | null) => void;
  closeVault: () => Promise<void>;
  /** 刷新最近笔记库列表 */
  loadRecent: () => Promise<void>;
  /** 切换到指定路径的笔记库 */
  switchVault: (path: string) => Promise<void>;
  /** 从最近列表中移除 */
  forgetRecent: (path: string) => Promise<void>;

  refresh: (dirPath?: string) => Promise<void>;
  toggleExpand: (dirPath: string) => Promise<void>;
  expandTo: (filePath: string) => Promise<void>;

  /** 读取某个目录的排序方式 */
  getSortMode: (dirPath: string) => Promise<"name" | "manual">;
  /** 设置某个目录的排序方式 */
  setSortMode: (dirPath: string, mode: "name" | "manual") => Promise<void>;
  /** 按给定的文件名顺序重排（自动切换为手动模式） */
  applyOrder: (dirPath: string, order: string[]) => Promise<void>;

  // ---- v0.2 知识连接 ----
  /** 当前笔记的反向链接 */
  backlinks: ContextHit[];
  /** 当前笔记的出链（指向哪些笔记） */
  outlinks: LinkRef[];
  /** 加载当前笔记的反向链接与出链 */
  loadLinks: (path: string) => Promise<void>;

  /** 全部标签与计数 */
  tags: TagCount[];
  /** 当前按标签筛选的标签（null = 未筛选） */
  tagFilter: string | null;
  /** 当前筛选出的笔记 */
  taggedNotes: NoteMeta[];
  /** 刷新标签列表 */
  loadTags: () => Promise<void>;
  /** 按标签筛选（传 null 清除） */
  filterByTag: (tag: string | null) => Promise<void>;
  /** 重命名标签（批量替换所有笔记） */
  renameTag: (oldTag: string, newTag: string) => Promise<void>;

  openNote: (path: string) => Promise<void>;
  /** 打开笔记并强制新开标签页（即使已在其它标签打开也切换过去） */
  openNoteInTab: (path: string) => Promise<void>;
  /** 关闭标签页（关闭当前标签时自动切到相邻标签） */
  closeTab: (path: string) => Promise<void>;
  /** 关闭其它所有标签页 */
  closeOtherTabs: (path: string) => Promise<void>;
  /** 在目录树中选中文件夹（不读取内容） */
  selectFolder: (dirPath: string) => void;
  /** 编辑时更新内容（标记未保存） */
  setContent: (content: string) => void;
  save: () => Promise<void>;
  setMode: (mode: EditorMode) => void;
  setSidebarOpen: (open: boolean) => void;

  createNote: (dirPath: string, name?: string) => Promise<void>;
  createFolder: (dirPath: string, name?: string) => Promise<void>;
  rename: (path: string, newName: string) => Promise<void>;
  remove: (path: string) => Promise<void>;

  toast: (text: string, kind?: Toast["kind"]) => void;
  dismissToast: (id: number) => void;
}

let toastSeq = 1;

/** 在目录内找一个不冲突的名字：`名称`、`名称 2`、`名称 3`… */
function uniqueName(base: string, siblings: FileNode[] | undefined, suffix = ""): string {
  const names = new Set((siblings ?? []).map((n) => n.name.toLowerCase()));
  let candidate = base;
  let i = 2;
  while (names.has((candidate + suffix).toLowerCase())) {
    candidate = `${base} ${i}`;
    i++;
  }
  return candidate;
}

export const useStore = create<AppStore>((set, get) => ({
  vault: null,
  recentVaults: [],
  children: {},
  expanded: {},
  selectedPath: null,
  selectedIsDir: false,
  note: null,
  tabs: [],
  splitPath: null,
  imagePreview: null,
  mode: "live",
  sidebarOpen: true,
  loadingNote: false,
  toasts: [],
  backlinks: [],
  outlinks: [],
  tags: [],
  tagFilter: null,
  taggedNotes: [],

  async loadVault() {
    try {
      const v = await api.getVault();
      if (v) {
        set({ vault: v });
        await get().refresh();
      }
    } catch (e) {
      get().toast(errText(e), "error");
    }
    // 无论是否恢复成功，都刷新一次最近列表（供切换菜单使用）
    await get().loadRecent();
    // 索引在 open_vault 时由后端构建，这里同步一份到前端缓存
    if (get().vault) { await refreshLinkIndex(); await get().loadTags(); }
    else clearLinkIndex();
  },

  setVault(v) {
    set({
      vault: v,
      children: {},
      expanded: {},
      note: null,
      tabs: [],
      splitPath: null,
      imagePreview: null,
      selectedPath: null,
      selectedIsDir: false,
    });
  },

  async closeVault() {
    try {
      await api.closeVault();
    } catch {
      /* 忽略 */
    }
    clearLinkIndex();
    get().setVault(null);
    await get().loadRecent();
  },

  async loadRecent() {
    try {
      const list = await api.getRecentVaults();
      set({ recentVaults: list });
    } catch {
      /* 读取最近列表失败不影响主流程 */
    }
  },

  async switchVault(path) {
    const current = get().vault;
    if (current && current.root.replace(/\\/g, "/").toLowerCase() === path.replace(/\\/g, "/").toLowerCase()) {
      return;
    }
    // 先保存当前未落盘的内容
    if (get().note?.dirty) {
      await get().save();
    }
    try {
      const v = await api.openVault(path);
      get().setVault(v);
      await get().refresh();
      await get().loadRecent();
      get().toast(`已切换到「${v.name}」`, "success");
    } catch (e) {
      get().toast(errText(e), "error");
    }
  },

  async forgetRecent(path) {
    try {
      await api.forgetVault(path);
      await get().loadRecent();
    } catch (e) {
      get().toast(errText(e), "error");
    }
  },

  async refresh(dirPath = "") {
    try {
      const nodes = await api.listDir(dirPath);
      set((s) => ({ children: { ...s.children, [dirPath]: nodes } }));
      // 已展开的子目录也刷新
      const expanded = get().expanded;
      for (const dir of Object.keys(expanded)) {
        if (dir !== dirPath && (dir === "" || dir.startsWith(dirPath))) {
          try {
            const sub = await api.listDir(dir);
            set((s) => ({ children: { ...s.children, [dir]: sub } }));
          } catch {
            /* 目录可能已被删除 */
          }
        }
      }
    } catch (e) {
      get().toast(errText(e), "error");
    }
  },

  async toggleExpand(dirPath) {
    const expanded = { ...get().expanded };
    if (expanded[dirPath]) {
      delete expanded[dirPath];
      set({ expanded });
    } else {
      expanded[dirPath] = true;
      set({ expanded });
      if (!get().children[dirPath]) {
        try {
          const nodes = await api.listDir(dirPath);
          set((s) => ({ children: { ...s.children, [dirPath]: nodes } }));
        } catch (e) {
          get().toast(errText(e), "error");
        }
      }
    }
  },

  async expandTo(filePath) {
    // 展开该文件所有的祖先目录，让它在树中可见
    const parts = filePath.split("/").slice(0, -1);
    const expanded = { ...get().expanded };
    let acc = "";
    for (const p of parts) {
      acc = acc ? `${acc}/${p}` : p;
      expanded[acc] = true;
      if (!get().children[acc]) {
        try {
          const nodes = await api.listDir(acc);
          set((s) => ({ children: { ...s.children, [acc]: nodes } }));
        } catch {
          /* 忽略 */
        }
      }
    }
    set({ expanded });
  },

  async getSortMode(dirPath) {
    try {
      const mode = await api.getDirSort(dirPath);
      return mode === "manual" ? "manual" : "name";
    } catch {
      return "name";
    }
  },

  async setSortMode(dirPath, mode) {
    try {
      await api.setDirSort(dirPath, mode);
      await get().refresh(dirPath);
      get().toast(
        mode === "manual" ? "已切换到手动排序，可拖动条目调整顺序" : "已按名称排序",
        "success",
      );
    } catch (e) {
      get().toast(errText(e), "error");
    }
  },

  async applyOrder(dirPath, order) {
    try {
      await api.setDirOrder(dirPath, order);
      await get().refresh(dirPath);
    } catch (e) {
      get().toast(errText(e), "error");
    }
  },

  async loadLinks(path) {
    if (!path) {
      set({ backlinks: [], outlinks: [] });
      return;
    }
    try {
      const [backlinks, outlinks] = await Promise.all([
        api.getBacklinks(path),
        api.getOutlinks(path),
      ]);
      // 切换笔记后旧结果可能才返回，丢弃过期数据
      if (get().note?.path !== path) return;
      set({ backlinks, outlinks });
    } catch {
      set({ backlinks: [], outlinks: [] });
    }
  },

  async loadTags() {
    try {
      const tags = await api.getAllTags();
      set({ tags });
    } catch {
      set({ tags: [] });
    }
  },

  async filterByTag(tag) {
    if (!tag) {
      set({ tagFilter: null, taggedNotes: [] });
      return;
    }
    try {
      const notes = await api.getNotesWithTag(tag);
      set({ tagFilter: tag, taggedNotes: notes });
    } catch (e) {
      get().toast(errText(e), "error");
    }
  },

  async renameTag(oldTag, newTag) {
    const from = oldTag.trim().replace(/^#/, "");
    const to = newTag.trim().replace(/^#/, "");
    if (!from || !to) {
      get().toast("标签名不能为空", "error");
      return;
    }
    if (from === to) return;
    // 目标标签已存在时合并——这是允许的，但要提示
    if (get().tags.some((t) => t.tag === to)) {
      if (!window.confirm(`标签「${to}」已存在，重命名后会合并到它下面。继续？`)) return;
    }
    try {
      const changed = await api.renameTag(from, to);
      // 内容变了：刷新标签、链接缓存；如果开着这篇笔记要重读
      await get().loadTags();
      await refreshLinkIndex();
      if (get().tagFilter === from) await get().filterByTag(to);
      const cur = get().note;
      if (cur) {
        const content = await api.readNote(cur.path);
        set({ note: { ...cur, content, dirty: false } });
        void get().loadLinks(cur.path);
      }
      get().toast(
        changed > 0 ? `已重命名标签，修改了 ${changed} 篇笔记` : "没有笔记使用这个标签",
        "success",
      );
    } catch (e) {
      get().toast(errText(e), "error");
    }
  },

  openInSplit(path) {
    if (!/\.md$/i.test(path)) {
      get().toast(`「${path}」不是笔记文件`, "error");
      return;
    }
    // 分屏里打开的就是当前笔记时不重复开
    if (get().note?.path === path) {
      set({ splitPath: path });
      return;
    }
    set({ splitPath: path });
  },

  closeSplit() {
    set({ splitPath: null });
  },

  showImage(path) {
    // 切换笔记前先保存未落盘内容
    const cur = get().note;
    if (cur?.dirty) void get().save();
    set({ imagePreview: path, selectedPath: path, selectedIsDir: false, note: null });
  },
  async openNote(path) {
    // 防御：只允许打开 .md 文件
    if (!/\.md$/i.test(path)) {
      get().toast(`「${path}」不是笔记文件`, "error");
      return;
    }
    const cur = get().note;
    if (cur && cur.path === path) return;
    if (cur?.dirty) {
      await get().save();
    }
    set({ loadingNote: true });
    try {
      const content = await api.readNote(path);
      const title = titleOf(path);
      // 保证这个笔记在标签栏里有一席之地
      const tabs = get().tabs;
      const nextTabs = tabs.some((t) => t.path === path)
        ? tabs
        : [...tabs, { path, title }];
      set({
        note: { path, title, content, dirty: false },
        tabs: nextTabs,
        selectedPath: path,
        selectedIsDir: false,
        imagePreview: null,
        loadingNote: false,
      });
      void get().loadLinks(path);
    } catch (e) {
      set({ loadingNote: false });
      get().toast(errText(e), "error");
    }
  },

  /**
   * 打开笔记（已在标签里就切过去）。
   * 与 openNote 的区别：即使当前就是它也会重新读取（用于「重新加载」）。
   */
  async openNoteInTab(path) {
    if (get().note?.path === path) {
      set({ note: null });
    }
    await get().openNote(path);
  },

  /** 关闭一个标签页；关的是当前标签时自动切到相邻的 */
  async closeTab(path) {
    const tabs = get().tabs;
    const idx = tabs.findIndex((t) => t.path === path);
    if (idx < 0) return;
    const rest = tabs.filter((t) => t.path !== path);

    if (get().note?.path !== path) {
      set({ tabs: rest });
      return;
    }
    // 关的是当前笔记：先保存，再切到右边（没有就切左边）
    if (get().note?.dirty) await get().save();
    const next = rest[idx] ?? rest[idx - 1] ?? null;
    set({ tabs: rest, note: null, imagePreview: null });
    if (next) {
      await get().openNote(next.path);
    } else {
      set({ selectedPath: null, selectedIsDir: false });
    }
  },

  /** 只留下指定标签页 */
  async closeOtherTabs(path) {
    const keep = get().tabs.filter((t) => t.path === path);
    set({ tabs: keep });
    if (get().note?.path !== path) await get().openNote(path);
  },

  /** 在目录树中选中一个文件夹（只选中，不读取内容） */
  selectFolder(dirPath) {
    const cur = get().note;
    if (cur?.dirty) {
      void get().save();
    }
    set({ selectedPath: dirPath, selectedIsDir: true, note: null });
  },

  setContent(content) {
    const note = get().note;
    if (!note) return;
    set({ note: { ...note, content, dirty: true } });
  },

  async save() {
    const note = get().note;
    if (!note || !note.dirty) return;
    try {
      await api.writeNote(note.path, note.content);
      set((s) => (s.note ? { note: { ...s.note, dirty: false } } : {}));
      // 标题 / 标签 / 双链可能变了，刷新前端链接缓存（后端已增量更新索引）
      void refreshLinkIndex();
      // 自己改了内容，反链/出链要重算
      void get().loadLinks(note.path);
    } catch (e) {
      get().toast(errText(e), "error");
    }
  },

  setMode(mode) {
    set({ mode });
  },

  setSidebarOpen(open) {
    set({ sidebarOpen: open });
  },

  async createNote(dirPath, name) {
    const base = (name ?? "未命名笔记").trim() || "未命名笔记";
    // 同名时自动编号：未命名笔记、未命名笔记 2 …
    const title = uniqueName(base, get().children[dirPath], ".md");
    const rel = dirPath ? `${dirPath}/${title}.md` : `${title}.md`;
    try {
      const created = await api.createNote(rel);
      if (dirPath) {
        set((s) => ({ expanded: { ...s.expanded, [dirPath]: true } }));
      }
      await get().refresh(dirPath);
      await get().openNote(created);
      get().toast("已新建笔记", "success");
    } catch (e) {
      get().toast(errText(e), "error");
    }
  },

  async createFolder(dirPath, name) {
    const base = (name ?? "新建文件夹").trim() || "新建文件夹";
    const title = uniqueName(base, get().children[dirPath]);
    const rel = dirPath ? `${dirPath}/${title}` : title;
    try {
      await api.createFolder(rel);
      set((s) => ({ expanded: { ...s.expanded, [dirPath]: true } }));
      await get().refresh(dirPath);
      get().toast("已新建文件夹", "success");
    } catch (e) {
      get().toast(errText(e), "error");
    }
  },

  async rename(path, newName) {
    const dir = parentOf(path);
    try {
      const next = await api.renameEntry(path, newName);
      const note = get().note;
      if (note?.path === path) {
        await get().save();
        set({
          note: { ...note, path: next, title: titleOf(next), dirty: false },
          selectedPath: next,
        });
      }
      await get().refresh(dir);
      get().toast("已重命名", "success");
    } catch (e) {
      get().toast(errText(e), "error");
    }
  },

  async remove(path) {
    const dir = parentOf(path);
    try {
      await api.deleteEntry(path, true);
      const note = get().note;
      if (note?.path === path) set({ note: null, selectedPath: null });
      // 删掉的笔记要把它的标签页也移除
      set({ tabs: get().tabs.filter((t) => t.path !== path) });
      delete get().children[path];
      await get().refresh(dir);
      get().toast("已删除", "success");
    } catch (e) {
      get().toast(errText(e), "error");
    }
  },

  toast(text, kind = "info") {
    // 相同文案 + 相同类型的提示合并计数，避免刷屏
    const same = get().toasts.find((t) => t.text === text && t.kind === kind);
    if (same) {
      set((s) => ({
        toasts: s.toasts.map((t) => (t.id === same.id ? { ...t, count: t.count + 1 } : t)),
      }));
      // 重新计时
      setTimeout(() => get().dismissToast(same.id), 3200);
      return;
    }
    // 最多同时显示 3 条
    const id = toastSeq++;
    set((s) => ({ toasts: [...s.toasts.slice(-2), { id, kind, text, count: 1 }] }));
    setTimeout(() => get().dismissToast(id), 3200);
  },

  dismissToast(id) {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },
}));

export type { FileNode };
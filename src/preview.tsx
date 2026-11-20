/**
 * 开发期预览页：在普通浏览器里渲染界面，不依赖 Tauri。
 * 访问 http://localhost:1420/preview.html
 */
import React from "react";
import ReactDOM from "react-dom/client";
import { EditorView } from "@codemirror/view";
import { Welcome } from "@/components/Welcome";
import { MarkdownEditor } from "@/editor/MarkdownEditor";
import type { EditorHandle } from "@/editor/MarkdownEditor";
import { Toolbar } from "@/components/Toolbar";
import { Outline } from "@/components/Outline";
import { Toasts } from "@/components/Toasts";
import { Sidebar } from "@/components/Sidebar";
import { useStore } from "@/stores/app";
import { setLinkIndex } from "@/lib/linkCache";
import { registerWikiActions } from "@/editor/livePreview";
import { LinksPanel } from "@/components/LinksPanel";
import { CommandPalette } from "@/components/CommandPalette";
import { ContentSearch } from "@/components/ContentSearch";
import { RightSidebar } from "@/components/RightSidebar";
import { SettingsPanel } from "@/components/SettingsPanel";
import App from "@/App";
import { defaultSettings } from "@/lib/settings";
import type { Settings } from "@/lib/settings";

// 调试/自动化测试用：把 store 暴露到 window
(window as unknown as Record<string, unknown>).__STORE__ = { useStore };

/** 供搜索类预览页使用的 IPC 桩：拦截 search_* 命令返回假数据 */
const MOCK_NOTES = [
  { path: "微积分基础.md", title: "微积分基础" },
  { path: "法学/民法典导论.md", title: "民法典导论" },
  { path: "C++程序设计基础/CPP-4 函数.md", title: "CPP-4 函数" },
  { path: "C++程序设计基础/CPP-9 文件操作与重定向.md", title: "CPP-9 文件操作与重定向" },
  { path: "Python应用开发/基础语法.md", title: "Python 基础语法" },
];

const MOCK_CONTENT = [
  {
    path: "微积分基础.md",
    title: "微积分基础",
    line: 5,
    snippet: "微积分的核心是极限，导数是它的工具",
    matchStart: 0,
    matchLen: 3,
  },
  {
    path: "微积分基础.md",
    title: "微积分基础",
    line: 18,
    snippet: "求导是微积分的基本运算之一",
    matchStart: 3,
    matchLen: 3,
  },
  {
    path: "法学/民法典导论.md",
    title: "民法典导论",
    line: 3,
    snippet: "这和法律推理很像，可以参照微积分里的极限思想来理解。",
    matchStart: 13,
    matchLen: 3,
  },
];

function installIpcMock() {
  const w = window as unknown as Record<string, unknown>;
  if (w.__TAURI_INTERNALS__) return;
  w.__TAURI_INTERNALS__ = {
    invoke: async (cmd: string, args?: Record<string, unknown>) => {
      const q = String(args?.query ?? "").trim().toLowerCase();
      if (cmd === "search_titles") {
        const list = !q
          ? MOCK_NOTES
          : MOCK_NOTES.filter(
              (n) =>
                n.title.toLowerCase().includes(q) || n.path.toLowerCase().includes(q),
            );
        return list.map((n) => ({ ...n, score: 100 }));
      }
      if (cmd === "search_content") {
        if (!q) return [];
        return MOCK_CONTENT.filter((h) => h.snippet.toLowerCase().includes(q));
      }
      throw new Error(`未 mock 的命令：${cmd}`);
    },
  };
}
import type { EditorMode } from "@/lib/types";
import "katex/dist/katex.min.css";
import "highlight.js/styles/github.css";
import "./styles/global.css";

const SAMPLE = `# 微积分基础：导数与积分

这是**栖知**的测试笔记，用来验证实时渲染效果。

## 一、基本概念

*导数的定义*：函数 $f(x)$ 在 $x_0$ 处的导数定义为

$$\\lim_{\\Delta x \\to 0} \\frac{f(x_0 + \\Delta x) - f(x_0)}{\\Delta x}$$

~~这是删除线~~，==这是高亮==，还有 \`行内代码\`。

## 二、常用公式

$$\\int_0^1 x^2 \\, dx = \\frac{1}{3}$$

## 三、代码示例

\`\`\`python
def derivative(f, x, h=1e-5):
    """数值求导"""
    return (f(x + h) - f(x - h)) / (2 * h)
\`\`\`

## 四、任务清单

- [x] 理解导数定义
- [ ] 完成课后习题

## 五、表格

| 函数 | 导数 |
| --- | --- |
| $x^n$ | $nx^{n-1}$ |

> 引用：数学是研究数量、结构、变化以及空间等概念的一门学科。

---

[这是一个链接](https://example.com)
`;

/** 用真实组件拼出的「文件夹被选中」状态，验证不再报错 */
function FolderSelectedMock() {
  return (
    <div className="app" style={{ height: "100vh" }}>
      <aside className="sidebar">
        <div className="sidebar-head">
          <div className="vault-name">
            <span className="vault-icon">🪶</span>
            <span className="vault-text">PeryxTestVault</span>
          </div>
        </div>
        <div className="tree">
          <div className="tree-item is-dir">
            <span className="caret open">▸</span>
            <span className="tree-icon">📂</span>
            <span className="tree-label">法学</span>
          </div>
          <div className="tree-item">
            <span className="caret-spacer" />
            <span className="tree-icon">📄</span>
            <span className="tree-label">民法典导论</span>
          </div>
          <div className="tree-item">
            <span className="caret-spacer" />
            <span className="tree-icon">📄</span>
            <span className="tree-label">微积分基础</span>
          </div>
          <div className="tree-item selected is-dir" style={{ paddingLeft: 6 }}>
            <span className="caret">▸</span>
            <span className="tree-icon">📁</span>
            <span className="tree-label">未命名笔记</span>
          </div>
        </div>
      </aside>
      <main className="main">
        <Toolbar getView={() => null} />
        <div className="workspace">
          <div className="editor-wrap">
            <div className="empty-state">
              <div className="empty-icon">📁</div>
              <p className="folder-title">法学</p>
              <p className="folder-sub">已选中文件夹。新笔记会创建在这个文件夹里。</p>
              <div className="empty-actions">
                <button className="btn-primary">在此新建笔记</button>
                <button className="btn-ghost">新建子文件夹</button>
              </div>
              <div className="empty-hints">从左侧点击一篇笔记即可开始编辑</div>
            </div>
          </div>
        </div>
        <div className="statusbar">
          <span className="sb-item">实时渲染</span>
          <span className="sb-spacer" />
        </div>
      </main>
      <Toasts />
    </div>
  );
}

/** 用真实 Sidebar 组件 + 模拟数据，验证「笔记库切换菜单」的观感 */
function SidebarMock() {
  // 灌入模拟状态
  React.useEffect(() => {
    useStore.setState({
      vault: { root: "D:\\PeryxTestVault", name: "PeryxTestVault" },
      recentVaults: [
        "D:\\PeryxTestVault",
        "D:\\学习笔记\\法学",
        "E:\\Notes\\计算机",
        "D:\\我的笔记库",
      ],
      children: {
        "": [
          { name: "微积分基础.md", path: "微积分基础.md", isDir: false, isImage: false, modifiedMs: 0, size: 900 },
          { name: "法学", path: "法学", isDir: true, isImage: false, modifiedMs: 0, size: 0 },
        ],
        "法学": [
          { name: "民法典导论.md", path: "法学/民法典导论.md", isDir: false, isImage: false, modifiedMs: 0, size: 50 },
        ],
      },
      expanded: { "法学": true },
      selectedPath: "微积分基础.md",
    });
  }, []);

  return (
    <div className="app" style={{ height: "100vh" }}>
      <Sidebar onCreateNote={() => {}} onCreateFolder={() => {}} onCollapse={() => {}} onOpenSettings={() => {}} />
      <main className="main">
        <div className="workspace">
          <div className="editor-wrap">
            <div className="empty-state">
              <div className="empty-icon">🪶</div>
              <p>点击左上角笔记库名称可以切换</p>
            </div>
          </div>
        </div>
      </main>
      <Toasts />
    </div>
  );
}

/** 双链渲染测试页：预置一批 [[链接]] 并注入存在的笔记名 */
function WikiLinkPreview() {
  const ref = React.useRef<EditorHandle | null>(null);

  React.useEffect(() => {
    // 假定这些笔记存在；其余判为「待创建」
    setLinkIndex([
      {
        path: "微积分基础.md",
        title: "微积分基础",
        tags: [],
        links: [],
        mtimeMs: 0,
        size: 0,
      },
      {
        path: "法学/民法典导论.md",
        title: "民法典导论",
        tags: [],
        links: [],
        mtimeMs: 0,
        size: 0,
      },
    ]);
    registerWikiActions({
      open: (p) => {
        (window as any).__WIKI_OPENED__ = p;
      },
      create: (n) => {
        (window as any).__WIKI_CREATED__ = n;
      },
    });
  }, []);

  const sample = [
    "# 双链测试",
    "",
    "链接到已存在的笔记：[[微积分基础]]",
    "",
    "带别名的链接：[[微积分基础|别名文字]]",
    "",
    "另一个已存在的：[[民法典导论]]",
    "",
    "指向不存在笔记的：[[还没有的笔记]]",
    "",
    "行内代码里的不算：`[[不该渲染]]`",
    "",
    "代码块里的也不算：",
    "",
    "```",
    "[[代码块里的链接]]",
    "```",
    "",
  ].join("\n");

  return (
    <div className="app" style={{ height: "100vh" }}>
      <main className="main">
        <div className="workspace">
          <div className="editor-wrap">
            <MarkdownEditor
              ref={(h) => {
                (window as any).__EDITOR_HANDLE__ = h;
                ref.current = h;
              }}
              docPath="wikilink-test.md"
              value={sample}
              mode="live"
              showLineNumbers={false}
              onChange={() => {}}
              onSave={() => {}}
            />
          </div>
        </div>
      </main>
    </div>
  );
}

/** 链接面板测试页：mock 反向链接与出链数据 */
function LinksPanelPreview() {
  React.useEffect(() => {
    useStore.setState({
      note: {
        path: "微积分基础.md",
        title: "微积分基础",
        content: "# 微积分基础\n",
        dirty: false,
      },
      backlinks: [
        {
          path: "法学/民法典导论.md",
          title: "民法典导论",
          line: 12,
          snippet: "这和法律推理很像，可以参照 [[微积分基础]] 里的极限思想来理解。",
          // `[[微积分基础]]` 共 9 个字符，起始下标 14
          matchStart: 14,
          matchLen: 9,
        },
        {
          path: "C++程序设计基础/CPP-4 函数.md",
          title: "CPP-4 函数",
          line: 3,
          snippet: "函数连续性参见 [[微积分基础]]。",
          matchStart: 8,
          matchLen: 9,
        },
      ],
      outlinks: [
        { target: "导数", alias: null, line: 5 },
        { target: "极限", alias: "极限的定义", line: 9 },
      ],
    });
  }, []);

  return (
    <div className="app" style={{ height: "100vh" }}>
      <main className="main">
        <div className="workspace">
          <div className="editor-wrap">
            <div className="empty-state">
              <div className="empty-icon">🔗</div>
              <p>链接面板预览</p>
            </div>
          </div>
          <LinksPanel
            onJump={(p, l) => {
              (window as unknown as Record<string, unknown>).__JUMPED__ = { path: p, line: l };
            }}
          />
        </div>
      </main>
    </div>
  );
}

/** 命令面板预览（Ctrl+P） */
function PalettePreview() {
  // 必须在首次渲染之前填充缓存：命令面板在 render 里读 allNoteMetas()
  if (!(window as unknown as Record<string, unknown>).__MOCK_READY__) {
    installIpcMock();
    setLinkIndex(
      MOCK_NOTES.map((n) => ({
        path: n.path,
        title: n.title,
        tags: [],
        links: [],
        mtimeMs: 0,
        size: 0,
      })),
    );
    (window as unknown as Record<string, unknown>).__MOCK_READY__ = true;
  }
  return (
    <div style={{ height: "100vh", background: "var(--bg)" }}>
      <CommandPalette onClose={() => {}} />
    </div>
  );
}

/** 全局搜索预览（Ctrl+Shift+F） */
function GSearchPreview() {
  if (!(window as unknown as Record<string, unknown>).__MOCK_READY__) {
    installIpcMock();
    (window as unknown as Record<string, unknown>).__MOCK_READY__ = true;
  }
  return (
    <div style={{ height: "100vh", background: "var(--bg)" }}>
      <ContentSearch
        onClose={() => {}}
        onJump={(p, l) => {
          (window as unknown as Record<string, unknown>).__JUMPED__ = { path: p, line: l };
        }}
      />
    </div>
  );
}

/** 编辑器里的 #标签 渲染测试页 */
function TagsPreview() {
  const ref = React.useRef<EditorHandle | null>(null);
  if (!(window as unknown as Record<string, unknown>).__TAG_MOCK__) {
    registerWikiActions({
      open: () => {},
      create: () => {},
      filterTag: (tag) => {
        (window as unknown as Record<string, unknown>).__FILTERED__ = tag;
      },
    });
    (window as unknown as Record<string, unknown>).__TAG_MOCK__ = true;
  }

  const sample = [
    "# 标签测试",
    "",
    "正文里的标签：#数学 和 #计算机/算法 ，还有 #Python。",
    "",
    "词中的不算：a#数学",
    "",
    "纯数字不算：#123",
    "",
    "行内代码里不算：`#数学`",
    "",
    "```c",
    "#include <stdio.h>",
    "```",
    "",
  ].join("\n");

  return (
    <div style={{ height: "100vh" }}>
      <MarkdownEditor
        ref={(h) => {
          (window as unknown as Record<string, unknown>).__EDITOR_HANDLE__ = h;
          ref.current = h;
        }}
        docPath="tags-test.md"
        value={sample}
        mode="live"
        showLineNumbers={false}
        onChange={() => {}}
        onSave={() => {}}
      />
    </div>
  );
}

/** 侧边栏标签视图测试页 */
function TagViewPreview() {
  if (!(window as unknown as Record<string, unknown>).__TAGVIEW_MOCK__) {
    useStore.setState({
      vault: { root: "D:\\Test", name: "Test" },
      tags: [
        { tag: "数学", count: 2 },
        { tag: "计算机/算法", count: 1 },
        { tag: "Python", count: 1 },
      ],
      filterByTag: async (tag) => {
        if (!tag) {
          useStore.setState({ tagFilter: null, taggedNotes: [] });
          return;
        }
        useStore.setState({
          tagFilter: tag,
          taggedNotes: [
            { path: "微积分基础.md", title: "微积分基础", tags: [], links: [], mtimeMs: 0, size: 0 },
            { path: "线性代数.md", title: "线性代数", tags: [], links: [], mtimeMs: 0, size: 0 },
          ],
        });
      },
    });
    (window as unknown as Record<string, unknown>).__TAGVIEW_MOCK__ = true;
  }

  return (
    <div className="app" style={{ height: "100vh" }}>
      <Sidebar onCreateNote={() => {}} onCreateFolder={() => {}} onCollapse={() => {}} onOpenSettings={() => {}} />
      <main className="main">
        <div className="workspace">
          <div className="editor-wrap">
            <div className="empty-state">
              <div className="empty-icon">🏷️</div>
              <p>标签视图预览（点侧边栏「标签」）</p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

/** 内嵌图片测试页：mock read_image_data_url */
function ImageEmbedPreview() {
  const ref = React.useRef<EditorHandle | null>(null);
  if (!(window as unknown as Record<string, unknown>).__IMG_MOCK__) {
    // 1x1 红色 PNG —— 真实可解码，能触发 img 的 load
    const redPng =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
      invoke: async (cmd: string, args?: Record<string, unknown>) => {
        if (cmd === "read_image_data_url") {
          const rel = String(args?.relPath ?? "");
          if (rel.includes("不存在")) throw new Error(`图片不存在：${rel}`);
          const g = globalThis as unknown as Record<string, unknown>;
          (g.__RESOLVE_LOG__ = (g.__RESOLVE_LOG__ as string[]) || []).push("read:" + rel);
          return redPng;
        }
        if (cmd === "resolve_attachment") {
          const target = String(args?.target ?? "");
          const g2 = globalThis as unknown as Record<string, unknown>;
          (g2.__RESOLVE_LOG__ = (g2.__RESOLVE_LOG__ as string[]) || []).push("resolve:" + target);
          // 模拟后端：只写文件名也能解析到 Picture/ 子目录
          if (target.includes("不存在")) return null;
          if (target.startsWith("assets/")) return target;
          return "Picture/" + target;
        }
        throw new Error(`未 mock 的命令：${cmd}`);
      },
    };
    (window as unknown as Record<string, unknown>).__IMG_MOCK__ = true;
  }

  const sample = [
    "# 图片嵌入测试",
    "",
    "正常图片：![[assets/封面.png]]",
    "",
    "只写文件名、文件在 Picture/ 子目录：![[G-HM-1.1 符号函数图像.jpg]]",
    "",
    "不存在的图片：![[assets/不存在.png]]",
    "",
    "代码块里的保持原样：",
    "",
    "```",
    "![[assets/代码块里的图片.png]]",
    "```",
    "",
  ].join("\n");

  return (
    <div style={{ height: "100vh" }}>
      <MarkdownEditor
        ref={(h) => {
          (window as unknown as Record<string, unknown>).__EDITOR_HANDLE__ = h;
          ref.current = h;
        }}
        docPath="image-test.md"
        value={sample}
        mode="live"
        showLineNumbers={false}
        onChange={() => {}}
        onSave={() => {}}
      />
    </div>
  );
}

/** 完整外壳预览：左侧栏 + 工具栏 + 右侧边栏（验证 v0.2.1 的结构改动） */
function ShellPreview() {
  const ref = React.useRef<EditorHandle | null>(null);
  const sample = "# 微积分基础\n\n## 一、基本概念\n\n正文\n";
  if (!(window as unknown as Record<string, unknown>).__SHELL_MOCK__) {
    useStore.setState({
      vault: { root: "D:\\Test", name: "Test" },
      sidebarOpen: true,
      note: {
        path: "微积分基础.md",
        title: "微积分基础",
        content: sample,
        dirty: false,
      },
      children: {
        "": [
          { name: "微积分基础.md", path: "微积分基础.md", isDir: false, isImage: false, modifiedMs: 0, size: 10 },
        ],
      },
      backlinks: [],
      outlinks: [],
    });
    (window as unknown as Record<string, unknown>).__SHELL_MOCK__ = true;
  }

  return (
    <div className="app">
      <Sidebar
        onCreateNote={() => {}}
        onCreateFolder={() => {}}
        onCollapse={() => {}}
        onOpenSettings={() => {}}
      />
      <main className="main">
        <Toolbar getView={() => ref.current?.view ?? null} />
        <div className="workspace">
          <div className="editor-wrap">
            <MarkdownEditor
              ref={(h) => {
                (window as unknown as Record<string, unknown>).__EDITOR_HANDLE__ = h;
                ref.current = h;
              }}
              docPath="微积分基础.md"
              value={sample}
              mode="live"
              showLineNumbers={false}
              onChange={() => {}}
              onSave={() => {}}
            />
          </div>
          <RightSidebar
            source={sample}
            onJumpLine={() => {}}
            onJumpNote={() => {}}
            onClose={() => {}}
          />
        </div>
      </main>
    </div>
  );
}

/** 设置面板预览 */
function SettingsPreview() {
  const [settings, setSettings] = React.useState<Settings>(defaultSettings);
  return (
    <div style={{ height: "100vh", background: "var(--bg)" }}>
      <SettingsPanel settings={settings} onChange={setSettings} onClose={() => {}} />
    </div>
  );
}

/**
 * 挂载真实 App（种好 store 数据 + mock IPC），
 * 用于验证快捷键这类「只在 App 里才有」的行为。
 */
function AppPreview() {
  if (!(window as unknown as Record<string, unknown>).__APP_MOCK__) {
    installIpcMock();
    const sample = "# 微积分基础\n\n## 一、基本概念\n\n正文 #数学\n";
    useStore.setState({
      vault: { root: "D:\\Test", name: "Test" },
      sidebarOpen: true,
      note: { path: "微积分基础.md", title: "微积分基础", content: sample, dirty: false },
      children: {
        "": [
          { name: "微积分基础.md", path: "微积分基础.md", isDir: false, isImage: false, modifiedMs: 0, size: 10 },
        ],
      },
      backlinks: [],
      outlinks: [],
      tags: [],
      recentVaults: [],
    });
    setLinkIndex([
      { path: "微积分基础.md", title: "微积分基础", tags: ["数学"], links: [], mtimeMs: 0, size: 10 },
    ]);
    (window as unknown as Record<string, unknown>).__APP_MOCK__ = true;
  }
  return <App />;
}

/** 文件树含图片 + 点击预览的测试页 */
function TreeImagePreview() {
  if (!(window as unknown as Record<string, unknown>).__TREEIMG_MOCK__) {
    const redPng =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
      invoke: async (cmd: string) => {
        if (cmd === "read_image_data_url") return redPng;
        if (cmd === "resolve_attachment") return null;
        if (cmd === "load_settings") return null;
        if (cmd === "get_vault") return null;
        if (cmd === "get_recent_vaults") return [];
        throw new Error(`未 mock 的命令：${cmd}`);
      },
    };
    useStore.setState({
      vault: { root: "D:\\Test", name: "Test" },
      sidebarOpen: true,
      note: {
        path: "微积分基础.md",
        title: "微积分基础",
        content: "# 微积分基础\n",
        dirty: false,
      },
      children: {
        "": [
          { name: "微积分基础.md", path: "微积分基础.md", isDir: false, isImage: false, modifiedMs: 0, size: 10 },
          { name: "Picture", path: "Picture", isDir: true, isImage: false, modifiedMs: 0, size: 0 },
          { name: "符号函数图像.jpg", path: "符号函数图像.jpg", isDir: false, isImage: true, modifiedMs: 0, size: 2048 },
        ],
        Picture: [],
      },
      expanded: { Picture: true },
      backlinks: [],
      outlinks: [],
      tags: [],
    });
    (window as unknown as Record<string, unknown>).__TREEIMG_MOCK__ = true;
  }
  return <App />;
}

/**
 * 光标能否点进被装饰区间内部（atomicRanges 过宽的回归测试）
 */
function CaretPreview() {
  const sample = [
    "# 光标测试",
    "",
    "这段有**加粗文字**在这里",
    "",
    "嵌入图片：![[图片.png]]",
    "",
    "双链：[[双链目标]] 结束",
    "",
  ].join("\n");

  if (!(window as unknown as Record<string, unknown>).__CARET_MOCK__) {
    const redPng =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
      invoke: async (cmd: string) => {
        if (cmd === "read_image_data_url") return redPng;
        if (cmd === "resolve_attachment") return "图片.png";
        if (cmd === "load_settings") return null;
        if (cmd === "get_vault") return null;
        if (cmd === "get_recent_vaults") return [];
        throw new Error(`未 mock 的命令：${cmd}`);
      },
    };
    useStore.setState({
      vault: { root: "D:\\Test", name: "Test" },
      sidebarOpen: true,
      note: { path: "光标测试.md", title: "光标测试", content: sample, dirty: false },
      children: {
        "": [
          { name: "光标测试.md", path: "光标测试.md", isDir: false, isImage: false, modifiedMs: 0, size: 10 },
        ],
      },
      backlinks: [],
      outlinks: [],
      tags: [],
    });
    setLinkIndex([
      { path: "双链目标.md", title: "双链目标", tags: [], links: [], mtimeMs: 0, size: 5 },
    ]);
    (window as unknown as Record<string, unknown>).__CARET_MOCK__ = true;
  }

  // 测试脚本需要一个拿到 EditorView 的入口
  React.useEffect(() => {
    const timer = window.setInterval(() => {
      const el = document.querySelector(".cm-editor");
      if (!el) return;
      const v = EditorView.findFromDOM(el as HTMLElement);
      if (!v) return;
      (window as unknown as Record<string, unknown>).__EDITOR_HANDLE__ = { view: v };
      window.clearInterval(timer);
    }, 200);
    return () => window.clearInterval(timer);
  }, []);

  return <App />;
}

/**
 * 加粗里的行内公式 + 块级公式阅读态
 */
function MathBoldPreview() {
  const sample = [
    "# 公式测试",
    "",
    "这种编码方式**能纠正 1 位错**，并能检出奇数位错、**突发长度 $\\le p+1$ 的突发错**以及很大一部分偶数位错。",
    "",
    "单行块公式：",
    "",
    "$$ \\eta = \\frac{pq}{(p+1)(q+1)} $$",
    "",
    "多行块公式：",
    "",
    "$$",
    "E = mc^2",
    "$$",
    "",
    "行内公式对照：这里有 $x^2+y^2$ 一个。",
    "",
  ].join("\n");

  if (!(window as unknown as Record<string, unknown>).__MATHBOLD_MOCK__) {
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
      invoke: async (cmd: string) => {
        if (cmd === "load_settings") return null;
        if (cmd === "get_vault") return null;
        if (cmd === "get_recent_vaults") return [];
        throw new Error(`未 mock 的命令：${cmd}`);
      },
    };
    useStore.setState({
      vault: { root: "D:\\Test", name: "Test" },
      sidebarOpen: true,
      note: { path: "公式测试.md", title: "公式测试", content: sample, dirty: false },
      children: {
        "": [
          { name: "公式测试.md", path: "公式测试.md", isDir: false, isImage: false, modifiedMs: 0, size: 10 },
        ],
      },
      backlinks: [],
      outlinks: [],
      tags: [],
    });
    setLinkIndex([]);
    (window as unknown as Record<string, unknown>).__MATHBOLD_MOCK__ = true;
  }

  React.useEffect(() => {
    const timer = window.setInterval(() => {
      const el = document.querySelector(".cm-editor");
      if (!el) return;
      const v = EditorView.findFromDOM(el as HTMLElement);
      if (!v) return;
      (window as unknown as Record<string, unknown>).__EDITOR_HANDLE__ = { view: v };
      window.clearInterval(timer);
    }, 200);
    return () => window.clearInterval(timer);
  }, []);

  return <App />;
}

/** 阅读模式测试页 */
function ReadingModePreview() {
  const sample = [
    "# 阅读模式测试",
    "",
    "## 二级标题",
    "",
    "这段有**加粗**和*斜体*，还有 `行内代码`。",
    "",
    "链接到已存在的笔记：[[微积分基础]]",
    "",
    "指向不存在的：[[还没有的笔记]]",
    "",
    "嵌入图片：![[封面.png]]",
    "",
    "标签：#数学 #笔记",
    "",
    "- 列表一",
    "- 列表二",
    "",
    "```js",
    "const a = 1;",
    "```",
    "",
    "| 列 A | 列 B |",
    "| --- | --- |",
    "| 1 | 2 |",
    "",
  ].join("\n");

  if (!(window as unknown as Record<string, unknown>).__READING_MOCK__) {
    const redPng =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
      invoke: async (cmd: string) => {
        if (cmd === "read_image_data_url") return redPng;
        if (cmd === "resolve_attachment") return "封面.png";
        if (cmd === "load_settings") return null;
        if (cmd === "get_vault") return null;
        if (cmd === "get_recent_vaults") return [];
        throw new Error(`未 mock 的命令：${cmd}`);
      },
    };
    useStore.setState({
      vault: { root: "D:\\Test", name: "Test" },
      sidebarOpen: true,
      mode: "read",
      note: { path: "阅读测试.md", title: "阅读测试", content: sample, dirty: false },
      children: {
        "": [
          { name: "阅读测试.md", path: "阅读测试.md", isDir: false, isImage: false, modifiedMs: 0, size: 10 },
        ],
      },
      backlinks: [],
      outlinks: [],
      tags: [],
    });
    setLinkIndex([
      { path: "微积分基础.md", title: "微积分基础", tags: [], links: [], mtimeMs: 0, size: 0 },
    ]);
    (window as unknown as Record<string, unknown>).__READING_MOCK__ = true;
  }

  // 记录阅读态点了哪个链接
  React.useEffect(() => {
    const orig = useStore.getState().openNote;
    useStore.setState({
      openNote: async (p: string) => {
        (window as unknown as Record<string, unknown>).__READ_OPENED__ = p;
        return orig(p);
      },
    });
  }, []);

  return <App />;
}

/** Callouts 示例内容 */
const CALLOUT_SAMPLE = [
  "# 标注块测试",
  "",
  "> [!note] 这是一条笔记",
  "> 正文内容，支持 **加粗** 和 `代码`。",
  "",
  "> [!warning] 注意安全",
  "> 这里要小心。",
  "",
  "> [!tip]",
  "> 没有标题时用默认标题。",
  "",
  "> 这是普通引用，不是标注。",
  "",
].join("\n");

/** 造一个 callout 测试用的 store */
function seedCalloutStore(mode: "read" | "live", flag: string): boolean {
  const g = window as unknown as Record<string, unknown>;
  if (g[flag]) return false;
  g.__TAURI_INTERNALS__ = {
    invoke: async (cmd: string) => {
      if (cmd === "load_settings") return null;
      if (cmd === "get_vault") return null;
      if (cmd === "get_recent_vaults") return [];
      throw new Error(`未 mock 的命令：${cmd}`);
    },
  };
  useStore.setState({
    vault: { root: "D:\\Test", name: "Test" },
    sidebarOpen: true,
    mode,
    note: { path: "标注测试.md", title: "标注测试", content: CALLOUT_SAMPLE, dirty: false },
    children: {
      "": [
        { name: "标注测试.md", path: "标注测试.md", isDir: false, isImage: false, modifiedMs: 0, size: 10 },
      ],
    },
    backlinks: [],
    outlinks: [],
    tags: [],
  });
  setLinkIndex([]);
  g[flag] = true;
  return true;
}

/** 阅读模式下的 callouts */
function CalloutReadPreview() {
  seedCalloutStore("read", "__CALLOUT_MOCK__");
  return <App />;
}

/** 实时渲染下的 callouts */
function CalloutLivePreview() {
  seedCalloutStore("live", "__CALLOUTLIVE_MOCK__");

  React.useEffect(() => {
    const timer = window.setInterval(() => {
      const el = document.querySelector(".cm-editor");
      if (!el) return;
      const v = EditorView.findFromDOM(el as HTMLElement);
      if (!v) return;
      (window as unknown as Record<string, unknown>).__EDITOR_HANDLE__ = { view: v };
      window.clearInterval(timer);
    }, 200);
    return () => window.clearInterval(timer);
  }, []);

  return <App />;
}

/** 脚注示例 */
const FOOTNOTE_SAMPLE = [
  "# 脚注测试",
  "",
  "正文里引用一个脚注[^1]，还有第二个[^2]，未定义的保持原样[^nope]。",
  "",
  "再来一次第一个[^1]。",
  "",
  "[^1]: 第一个脚注的内容。",
  "[^2]: 第二个脚注，比较长，",
  "  可以续行。",
  "",
  "正文结束。",
  ...Array.from({ length: 40 }, (_, i) => `第 ${i + 1} 段填充内容，用来撑高页面产生滚动。`),
  "",
].join("\n");

/** 阅读模式下的脚注 */
function FootnotePreview() {
  seedCalloutStore("read", "__FN_MOCK__");
  if (!(window as unknown as Record<string, unknown>).__FN_SEEDED__) {
    useStore.setState({
      note: { path: "脚注测试.md", title: "脚注测试", content: FOOTNOTE_SAMPLE, dirty: false },
    });
    (window as unknown as Record<string, unknown>).__FN_SEEDED__ = true;
  }
  return <App />;
}



/** Mermaid 测试内容 */
const MERMAID_SAMPLE = [
  "# Mermaid 测试",
  "",
  "```mermaid",
  "graph TD",
  "  A[开始] --> B{判断}",
  "  B -->|是| C[结束]",
  "  B -->|否| A",
  "```",
  "",
  "```mermaid",
  "this is not valid mermaid !!!",
  "```",
  "",
  "```js",
  "const x = 1;",
  "```",
  "",
].join("\n");

/** 阅读模式下的 mermaid */
function MermaidPreview() {
  seedCalloutStore("read", "__MERMAID_MOCK__");
  if (!(window as unknown as Record<string, unknown>).__MERMAID_SEEDED__) {
    useStore.setState({
      note: { path: "图表测试.md", title: "图表测试", content: MERMAID_SAMPLE, dirty: false },
    });
    (window as unknown as Record<string, unknown>).__MERMAID_SEEDED__ = true;
  }
  return <App />;
}

/** 实时渲染下的 mermaid */
function MermaidLivePreview() {
  seedCalloutStore("live", "__MERMAIDLIVE_MOCK__");
  if (!(window as unknown as Record<string, unknown>).__MERMAIDLIVE_SEEDED__) {
    useStore.setState({
      note: { path: "图表测试.md", title: "图表测试", content: MERMAID_SAMPLE, dirty: false },
    });
    (window as unknown as Record<string, unknown>).__MERMAIDLIVE_SEEDED__ = true;
  }

  React.useEffect(() => {
    const timer = window.setInterval(() => {
      const el = document.querySelector(".cm-editor");
      if (!el) return;
      const v = EditorView.findFromDOM(el as HTMLElement);
      if (!v) return;
      (window as unknown as Record<string, unknown>).__EDITOR_HANDLE__ = { view: v };
      window.clearInterval(timer);
    }, 200);
    return () => window.clearInterval(timer);
  }, []);

  return <App />;
}

/** 大纲滚动跟随测试：多章节 + 足够长的内容 */
const OUTLINE_SAMPLE = (() => {
  const parts = ["# 总标题", ""];
  for (let i = 1; i <= 6; i++) {
    parts.push(`## 第 ${i} 章`, "");
    for (let k = 0; k < 6; k++) {
      parts.push(`第 ${i} 章的第 ${k + 1} 段内容，用来撑开高度。`, "");
    }
  }
  return parts.join("\n");
})();

/** 大纲跟随测试页 */
function OutlinePreview() {
  seedCalloutStore("live", "__OUTLINE_MOCK__");
  if (!(window as unknown as Record<string, unknown>).__OUTLINE_SEEDED__) {
    useStore.setState({
      note: { path: "大纲测试.md", title: "大纲测试", content: OUTLINE_SAMPLE, dirty: false },
    });
    (window as unknown as Record<string, unknown>).__OUTLINE_SEEDED__ = true;
  }
  return <App />;
}

/** 标签页测试：三篇笔记 */
function TabsPreview() {
  seedCalloutStore("live", "__TABS_MOCK__");
  if (!(window as unknown as Record<string, unknown>).__TABS_SEEDED__) {
    const g = window as unknown as Record<string, unknown>;
    g.__TAURI_INTERNALS__ = {
      invoke: async (cmd: string, args: Record<string, unknown>) => {
        if (cmd === "load_settings") return null;
        if (cmd === "get_vault") return null;
        if (cmd === "get_recent_vaults") return [];
        if (cmd === "read_note") {
          const rel = String(args?.relPath ?? "");
          return `# ${rel.replace(/\.md$/, "")}\n\n内容。\n`;
        }
        if (cmd === "get_backlinks") return [];
        if (cmd === "get_outlinks") return [];
        if (cmd === "write_note") return null;
        throw new Error(`未 mock 的命令：${cmd}`);
      },
    };
    const node = (title: string) => ({
      name: `${title}.md`,
      path: `${title}.md`,
      isDir: false,
      isImage: false,
      modifiedMs: 0,
      size: 10,
    });
    useStore.setState({
      vault: { root: "D:\\Test", name: "Test" },
      sidebarOpen: true,
      mode: "live",
      note: null,
      tabs: [],
      children: { "": [node("笔记A"), node("笔记B"), node("笔记C")] },
      backlinks: [],
      outlinks: [],
      tags: [],
    });
    setLinkIndex([]);
    g.__TABS_SEEDED__ = true;
  }
  return <App />;
}

/** 分屏测试页 */
function SplitPreview() {
  seedCalloutStore("live", "__SPLIT_MOCK__");
  if (!(window as unknown as Record<string, unknown>).__SPLIT_SEEDED__) {
    const g = window as unknown as Record<string, unknown>;
    g.__SPLIT_WRITES__ = [];
    const store: Record<string, string> = {
      "笔记A.md": "# 笔记A\n\n这是 A 的内容。\n",
      "笔记B.md": "# 笔记B\n\n这是 B 的内容。\n",
      "属性笔记.md": [
        "---",
        "title: 属性笔记",
        "aliases:",
        "  - 属性别名一",
        "  - 属性别名二",
        "tags:",
        "  - 数学",
        "difficulty: 中等",
        "---",
        "",
        "# 属性笔记",
        "",
        "正文里链接到 [[别名目标]]。",
        "",
      ].join("\n"),
      "别名目标.md": [
        "---",
        "aliases:",
        "  - 目标别名",
        "---",
        "",
        "# 别名目标",
        "",
        "这篇笔记的别名是「目标别名」。",
        "",
      ].join("\n"),
    };
    g.__TAURI_INTERNALS__ = {
      invoke: async (cmd: string, args: Record<string, unknown>) => {
        if (cmd === "load_settings") return null;
        if (cmd === "get_vault") return null;
        if (cmd === "get_recent_vaults") return [];
        if (cmd === "read_note") return store[String(args?.relPath ?? "")] ?? "";
        if (cmd === "write_note") {
          const rel = String(args?.relPath ?? "");
          store[rel] = String(args?.content ?? "");
          (g.__SPLIT_WRITES__ as unknown[]).push({ path: rel, text: store[rel] });
          return null;
        }
        if (cmd === "get_backlinks") return [];
        if (cmd === "get_outlinks") return [];
        if (cmd === "resolve_attachment") return null;
        if (cmd === "read_image_data_url") return "";
        throw new Error(`未 mock 的命令：${cmd}`);
      },
    };
    const node = (title: string) => ({
      name: `${title}.md`,
      path: `${title}.md`,
      isDir: false,
      isImage: false,
      modifiedMs: 0,
      size: 10,
    });
    useStore.setState({
      vault: { root: "D:\\Test", name: "Test" },
      sidebarOpen: true,
      mode: "live",
      note: null,
      tabs: [],
      splitPath: null,
      children: {
        "": [node("笔记A"), node("笔记B"), node("属性笔记"), node("别名目标")],
      },
      backlinks: [],
      outlinks: [],
      tags: [],
    });
    // 链接缓存要带别名，`[[别名]]` 才能解析
    setLinkIndex(
      ["笔记A", "笔记B", "属性笔记", "别名目标"].map((t) => ({
        path: `${t}.md`,
        title: t,
        tags: [],
        links: [],
        aliases: t === "别名目标" ? ["目标别名"] : [],
        mtimeMs: 0,
        size: 10,
      })),
    );
    g.__SPLIT_SEEDED__ = true;
  }
  return <App />;
}

function Preview() {
  const query = new URLSearchParams(location.search);
  const page = query.get("page");
  const initialMode = (query.get("mode") === "source" ? "source" : "live") as EditorMode;
  const [mode] = React.useState<EditorMode>(initialMode);
  const [content, setContent] = React.useState(SAMPLE);
  const ref = React.useRef<EditorView | null>(null);

  if (page === "welcome") return <Welcome />;
  if (page === "folder") return <FolderSelectedMock />;
  if (page === "sidebar") return <SidebarMock />;
  if (page === "wikilink") return <WikiLinkPreview />;
  if (page === "links") return <LinksPanelPreview />;
  if (page === "palette") return <PalettePreview />;
  if (page === "gsearch") return <GSearchPreview />;
  if (page === "tags") return <TagsPreview />;
  if (page === "tagview") return <TagViewPreview />;
  if (page === "image") return <ImageEmbedPreview />;
  if (page === "shell") return <ShellPreview />;
  if (page === "settings") return <SettingsPreview />;
  if (page === "app") return <AppPreview />;
  if (page === "treeimg") return <TreeImagePreview />;
  if (page === "caret") return <CaretPreview />;
  if (page === "mathbold") return <MathBoldPreview />;
  if (page === "reading") return <ReadingModePreview />;
  if (page === "callout-read") return <CalloutReadPreview />;
  if (page === "callout-live") return <CalloutLivePreview />;
  if (page === "footnote") return <FootnotePreview />;
  if (page === "mermaid") return <MermaidPreview />;
  if (page === "mermaid-live") return <MermaidLivePreview />;
  if (page === "outline") return <OutlinePreview />;
  if (page === "tabs") return <TabsPreview />;
  if (page === "split") return <SplitPreview />;

  React.useEffect(() => {
    let cancelled = false;
    let tries = 0;
    const trySet = () => {
      if (cancelled) return;
      tries++;
      const handle = (window as any).__EDITOR_HANDLE__;
      const view: EditorView | null = handle?.view ?? null;
      if (!view) {
        if (tries < 40) setTimeout(trySet, 150);
        return;
      }
      const end = view.state.doc.length;
      view.dispatch({ selection: { anchor: end }, scrollIntoView: false });
      (window as any).__CURSOR_INFO__ = {
        cursor: view.state.selection.main.head,
        doclen: end,
        activeLine: view.state.doc.lineAt(view.state.selection.main.head).number,
        tries,
      };
    };
    trySet();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="app" style={{ height: "100vh" }}>
      <main className="main">
        <Toolbar getView={() => ref.current} />
        <div className="workspace">
          <div className="editor-wrap">
            <div className="note-head">
              <h1 className="note-title">微积分基础</h1>
            </div>
            <MarkdownEditor
              ref={(h) => {
                (window as any).__EDITOR_HANDLE__ = h;
                ref.current = h?.view ?? null;
              }}
              docPath="test.md"
              value={content}
              mode={mode}
              showLineNumbers={false}
              onChange={setContent}
              onSave={() => {}}
            />
          </div>
          <Outline source={content} onJump={() => {}} />
        </div>
        <div className="statusbar">
          <span className="sb-item">{mode === "live" ? "实时渲染" : "源码模式"}</span>
          <span className="sb-spacer" />
          <span className="sb-item">{content.length} 字符</span>
        </div>
      </main>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Preview />
  </React.StrictMode>,
);

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

// 调试/自动化测试用：把 store 暴露到 window
(window as unknown as Record<string, unknown>).__STORE__ = { useStore };
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
        <Toolbar getView={() => null} mode="live" onModeChange={() => {}} />
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
          { name: "微积分基础.md", path: "微积分基础.md", isDir: false, modifiedMs: 0, size: 900 },
          { name: "法学", path: "法学", isDir: true, modifiedMs: 0, size: 0 },
        ],
        "法学": [
          { name: "民法典导论.md", path: "法学/民法典导论.md", isDir: false, modifiedMs: 0, size: 50 },
        ],
      },
      expanded: { "法学": true },
      selectedPath: "微积分基础.md",
    });
  }, []);

  return (
    <div className="app" style={{ height: "100vh" }}>
      <Sidebar onCreateNote={() => {}} onCreateFolder={() => {}} onCollapse={() => {}} />
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

function Preview() {
  const query = new URLSearchParams(location.search);
  const page = query.get("page");
  const initialMode = (query.get("mode") === "source" ? "source" : "live") as EditorMode;
  const [mode, setMode] = React.useState<EditorMode>(initialMode);
  const [content, setContent] = React.useState(SAMPLE);
  const ref = React.useRef<EditorView | null>(null);

  if (page === "welcome") return <Welcome />;
  if (page === "folder") return <FolderSelectedMock />;
  if (page === "sidebar") return <SidebarMock />;
  if (page === "wikilink") return <WikiLinkPreview />;
  if (page === "links") return <LinksPanelPreview />;

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
        <Toolbar getView={() => ref.current} mode={mode} onModeChange={setMode} />
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

# 栖知 Peryx

> 以 Markdown 书写，让知识在这里筑巢。

个性化本地 Markdown 学习笔记软件。笔记就是你自己文件夹里的 `.md` 文件，不锁定格式，随时可以用任何编辑器打开。

当前版本：**v0.2.0** —— 知识连接（双链 / 反链 / 搜索 / 标签）

![欢迎页](docs/welcome.png)

**实时渲染模式**（隐藏 Markdown 符号，直接看到排版效果）：

![实时渲染](docs/live-preview.png)

**源码模式**（显示完整语法，便于精确编辑）：

![源码模式](docs/source-mode.png)

---

## 为什么做这个

Obsidian 好用，但对不熟悉 Markdown 的人有门槛；Typora 轻，但缺少知识管理。

Peryx 的目标是**既保留本地文件的可控性，又不用先学语法**：
所有 Markdown 语法都有工具栏按钮，同时提供类似 Word 的即时排版观感。

## 功能

### 编辑体验

- **双模式编辑器**：实时渲染 ↔ 源码模式一键切换
- **光标行展开**：光标移到哪一行，该行的 Markdown 标记（`###`、`**`、`>`、`$...$`）就显示出来，方便精确修改
- **Markdown 快捷工具栏**：16 个命令，不懂 Markdown 也能写
  - 标题 H1/H2/H3、正文、加粗、斜体、删除线、高亮、行内代码
  - 无序列表、有序列表、任务列表、引用、分割线
  - 链接、图片、表格、数学公式、代码块（均带插入对话框）
- **任务列表可点击**：复选框直接点，不用改源码
- **代码块语法高亮**（highlight.js，支持 100+ 语言）
- **链接可跳转**：`Ctrl/Cmd + 点击` 用系统浏览器打开
- **图片**：选本地图片自动复制到 `assets/`，插入相对路径

### 公式与表格

- **LaTeX 公式**：行内 `$...$` 与块级 `$$...$$`，KaTeX 渲染
- **编辑时保留预览**：改公式源码时，下方仍然显示渲染结果
- **表格是真正的表格**：渲染为 HTML `<table>`，列宽自动对齐、表头加粗
  - **点击单元格就地编辑**（Obsidian 风格），公式、粗体在单元格内也会渲染
  - 聚焦单元格时显示原始 Markdown，失焦自动写回

### 文件与笔记库

- **笔记库**：选择任意本地文件夹；也可新建（自动生成欢迎笔记）
- **仓库切换**：点左上角笔记库名称即可在多个库之间切换
- **记住上次打开的库**：下次启动直接进入，不用重新选择
- **目录树**：嵌套文件夹 + `.md` 文件；新建 / 重命名 / 删除
- **自然排序**：`CPP-2` 排在 `CPP-10` 前面（和 Obsidian 一致），文件夹优先
- **手动排序**：右键文件夹可切换「手动排序」，直接拖动条目调整顺序
- **大纲面板**：提取标题，点击跳转
- **自动保存**：停止输入 800ms 自动写盘；`Ctrl+S` 手动保存；关窗保存
- **路径安全**：所有文件操作强制限制在笔记库目录内，防越界

### 知识连接（v0.2）

- **双向链接**：写 `[[笔记名]]` 建立链接，点击跳转；`[[笔记名|别名]]` 可自定义显示文字
- **待创建链接**：指向不存在的笔记时显示灰色虚线，点击直接创建
- **链接自动补全**：输入 `[[` 弹出候选列表
- **反向链接面板**：右侧显示「哪些笔记引用了我」，含上下文片段与行号，点击跳转
- **出链面板**：查看当前笔记引用了哪些笔记
- **命令面板** `Ctrl+P`：按标题 / 路径模糊搜索，回车跳转
- **全局搜索** `Ctrl+Shift+F`：搜索所有笔记正文，结果按笔记分组并高亮命中
- **标签**：正文写 `#标签` 自动识别，侧边栏「标签」页签可浏览与筛选
- **标签重命名**：批量替换所有笔记里的标签，代码块内的不会被误改

## 快捷键

| 快捷键 | 功能 |
|---|---|
| `Ctrl + N` | 新建笔记 |
| `Ctrl + Shift + N` | 新建文件夹 |
| `Ctrl + S` | 保存 |
| `Ctrl + O` | 刷新目录树 |
| `Ctrl + P` | 命令面板（按标题跳转） |
| `Ctrl + Shift + F` | 全局全文搜索 |
| `Ctrl + Shift + P` | 切换实时渲染 / 源码模式 |
| `Ctrl + B` | 加粗 |
| `Ctrl + I` | 斜体 |
| `Ctrl + Shift + S` | 删除线 |
| `Ctrl + E` | 行内代码 |
| `Ctrl + K` | 插入链接 |
| `Ctrl + Shift + K` | 插入代码块 |
| `Ctrl + F` | 编辑器内查找 |
| `Ctrl + 点击链接` | 用系统浏览器打开 / 编辑双链 |

---

## 安装

从 [Releases](https://github.com/NakikaML/Peryx/releases) 下载：

- **`Peryx_0.1.0_x64-setup.exe`** —— NSIS 安装包，推荐
- 安装后从开始菜单启动「栖知 Peryx」

系统要求：Windows 10 1803+ / Windows 11，需要 WebView2 Runtime（Win11 自带，Win10 通常已随 Edge 安装）。

## 开发

### 环境要求

- Node.js ≥ 20（当前用 24.14.1）
- Rust stable（当前 1.100.0，MSVC 工具链）
- Visual Studio 的「使用 C++ 的桌面开发」工作负载
- WebView2 Runtime（Win10 1803+ 自带）

运行环境自检：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\check-env.ps1
```

### 常用命令

```powershell
npm install                           # 安装依赖（也可用 pnpm）
npx tauri dev                         # 开发模式（前端热更新；改 Rust 需重启该进程）
npx tauri build --debug --no-bundle   # 只编译 exe，不打包
npx tauri build                       # 生产构建 + NSIS 安装包
cargo test --manifest-path src-tauri/Cargo.toml   # Rust 单元测试
npx tsc --noEmit                      # 前端类型检查
```

### 测试

前端测试基于 Chrome DevTools Protocol 模拟真实鼠标事件，验证「点击位置是否落在预期字符上」这类
光看代码发现不了的问题。运行前需先启动开发服务器（`npx tauri dev` 或 `npx vite --port 1420`）：

```powershell
npm run test:click    # 点击定位（实时渲染 / 源码两种模式）
npm run test:live     # Obsidian 式展开交互
npm run test:issues   # 8 项交互需求
npm run test:table    # 表格单元格就地编辑
npm run test:math     # 公式编辑时保留渲染
npm run test:sort     # 自然排序 + 拖拽排序
npm run test:links    # 反向链接面板
npm run test:search   # 命令面板 + 全局搜索
npm run test:wiki     # [[双链]] 渲染
npm run test:complete # [[ 自动补全
npm run test:tags     # #标签 渲染与筛选
```

> ⚠️ **改了代码没生效？** 若直接双击运行 `peryx.exe`，必须先重新
> `npx tauri build --debug --no-bundle`，否则跑的还是旧二进制。用 `npx tauri dev` 时前端会自动热更新。

> ⚠️ **在 cmd 里不要带 `#` 注释**
> `cmd.exe` 不把 `#` 当注释。下面这种写法会把整段注释当成参数传给 cargo，报
> `error: unexpected argument '#' found`：
>
> ```cmd
> npx tauri build --debug --no-bundle    # 确保是最新代码   ← 错误
> ```
>
> 正确做法：只用 PowerShell（`#` 可用），或在 cmd 里去掉注释、改用 `REM`。
> 本 README 里所有示例都是 **PowerShell** 写法。

### 目录结构

```
Peryx
├─ src/                     # React 前端
│  ├─ components/           # Sidebar 目录树、Toolbar 工具栏、Outline 大纲、Welcome 欢迎页…
│  ├─ editor/
│  │  ├─ MarkdownEditor.tsx # CodeMirror 6 编辑器组件
│  │  ├─ livePreview.ts     # 实时渲染扩展（Decoration 就地渲染）
│  │  ├─ commands.ts        # 编辑命令（工具栏与快捷键共用）
│  │  ├─ linkHandler.ts     # 链接点击跳转
│  │  └─ theme.ts           # 编辑器主题
│  ├─ lib/
│  │  ├─ api.ts             # Tauri 命令的 TS 封装
│  │  ├─ markdown.ts        # Markdown 渲染管线（markdown-it + KaTeX + hljs）
│  │  └─ types.ts
│  ├─ stores/app.ts         # Zustand 全局状态
│  └─ styles/global.css
├─ src-tauri/
│  ├─ src/commands.rs       # 文件系统命令 + 路径越界防护 + 排序 + 单元测试
│  ├─ src/lib.rs            # Tauri 入口、启动时恢复上次笔记库
│  ├─ capabilities/         # 权限配置
│  └─ tauri.conf.json
├─ scripts/                 # CDP 自动化测试
├─ check-env.ps1            # 环境自检
└─ DEVELOP.md               # 完整开发日志、踩坑记录与路线图
```

## 技术栈

| 层 | 选型 |
|---|---|
| 桌面壳 | Tauri v2（2.12.x） |
| 前端 | React 18 + TypeScript + Vite 6 |
| 编辑器 | CodeMirror 6 |
| Markdown | markdown-it 15 + KaTeX 0.19 + highlight.js 11 |
| 状态 | Zustand 5 |

## 设计原则

1. **本地优先**：数据就是你自己的文件，不做私有格式封装
2. **不学 Markdown 也能用**：所有语法都有工具栏入口
3. **可扩展内核**：文件读写全部收敛到 `commands.rs` 一层，将来接到同步、双链、AI agent 都从这一层扩展
4. **验证优先于宣称**：每个交互都有对应的自动化测试，改完先跑测试再下结论

## 已知限制

- 目前仅支持 Windows（macOS / Linux 理论上可编译，未测试）
- 中文按 Unicode 码点排序，暂不支持拼音排序
- 拖动排序仅支持同一目录内，不支持跨文件夹拖动
- 表格暂不支持增删行列（仅支持改单元格内容）
- 未做双链 `[[ ]]`、全局搜索、标签（规划中）

## 后续规划

见 [DEVELOP.md](./DEVELOP.md)。路线图概要：

- v0.2 知识连接：双链 `[[ ]]`、反向链接、全局搜索、标签、SQLite 索引
- v0.3 编辑体验增强：大纲折叠、导出 PDF、主题切换、多标签页
- v0.4 同步：WebDAV / 自建服务端 + 冲突合并
- v0.5 学科工具插件：法条案例库、数学绘图、电路图
- v0.6 语言学习：单词库、复习算法（SRS）
- v0.7 P2P 学习共享
- v0.8 AI Agent：笔记问答 + 出题解析
- Android 端：Tauri v2 移动端复用同一套前端

## 许可证

MIT


/**
 * 每篇笔记自己的视图切换：
 *  A. 工具栏上不再有模式切换
 *  B. 笔记顶部（工具栏下方）有小按钮组
 *  C. 点「源码」→ 编辑器进入源码模式
 *  D. 点「阅读」→ 渲染成只读视图
 *  E. 点「编辑」→ 回到实时渲染
 *  F. 分屏里有自己的一份，且与主面板互不影响
 */
import http from "node:http";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9700;
const get = (port, p) =>
  new Promise((res, rej) => {
    http.get({ host: "127.0.0.1", port, path: p }, (r) => {
      let d = "";
      r.on("data", (c) => (d += c));
      r.on("end", () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } });
    }).on("error", rej);
  });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const profile = path.join(process.env.TEMP, "peryx-mode-" + Date.now());
  const chrome = spawn(CHROME, [
    "--headless=new", "--disable-gpu", "--no-first-run",
    `--user-data-dir=${profile}`, `--remote-debugging-port=${PORT}`,
    "--window-size=1500,950", "http://localhost:1420/preview.html?page=split",
  ], { stdio: "ignore" });

  let t = null;
  for (let i = 0; i < 80; i++) {
    await sleep(250);
    try { t = await get(PORT, "/json/list"); if (t?.length) break; } catch {}
  }
  if (!t) { console.error("无法连接 Chrome"); process.exit(1); }
  const ws = new WebSocket(t.find((x) => x.type === "page").webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let seq = 0;
  const w = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && w.has(m.id)) { w.get(m.id)(m); w.delete(m.id); }
  };
  const cdp = (method, params = {}) =>
    new Promise((r) => { const id = ++seq; w.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
  const js = async (x) => {
    const r = await cdp("Runtime.evaluate", { expression: x, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || "err");
    return r.result?.result?.value;
  };
  await sleep(3200);

  const results = [];

  const openNote = async (name) => {
    await js(`(() => {
      const i = Array.from(document.querySelectorAll('.tree-item'))
        .find(e => (e.textContent || '').includes('${name}'));
      if (i) i.click();
      return true;
    })()`);
    await sleep(800);
  };

  const clickMode = (scope, mode) =>
    js(`(() => {
      const root = document.querySelector('${scope}');
      if (!root) return { err: 'no ' + '${scope}' };
      const btn = root.querySelector('[data-mode="${mode}"]');
      if (!btn) return { err: 'no mode btn' };
      btn.click();
      return { ok: true };
    })()`);

  const snap = () =>
    js(`(() => {
      const main = document.querySelector('.editor-wrap');
      const side = document.querySelector('.split-pane');
      const state = (root) => {
        if (!root) return null;
        return {
          activeMode: root.querySelector('.pane-mode-btn.on')?.dataset.mode ?? null,
          reading: !!root.querySelector('.reading-view'),
          editor: !!root.querySelector('.cm-editor'),
          // 实时/阅读态会隐藏 Markdown 标记（.cm-mark-hidden），源码态不隐藏
          hiddenMarks: root.querySelectorAll('.cm-mark-hidden').length,
          markVisible: root.querySelectorAll('.cm-mark-visible').length,
        };
      };
      return { main: state(main), side: state(side) };
    })()`);

  await openNote("笔记A");

  // A/B. 工具栏没有模式切换；笔记顶部有
  const layout = await js(`(() => {
    const toolbar = document.querySelector('.toolbar');
    const noteHead = document.querySelector('.note-head');
    return {
      toolbarModeSwitch: toolbar ? toolbar.querySelectorAll('.mode-switch, .pane-mode-switch').length : -1,
      noteHeadSwitch: noteHead ? noteHead.querySelectorAll('.pane-mode-switch .pane-mode-btn').length : -1,
      // 位置：切换器在工具栏下方（y 更大）
      toolbarBottom: toolbar ? Math.round(toolbar.getBoundingClientRect().bottom) : null,
      switchTop: (() => {
        const el = document.querySelector('.note-head .pane-mode-switch');
        return el ? Math.round(el.getBoundingClientRect().top) : null;
      })(),
    };
  })()`);

  results.push({
    label: "A. 工具栏上不再有模式切换",
    toolbarModeSwitch: layout.toolbarModeSwitch,
    pass: layout.toolbarModeSwitch === 0,
  });

  results.push({
    label: "B. 笔记顶部有 3 个模式按钮，且位于工具栏下方",
    noteHeadSwitch: layout.noteHeadSwitch,
    toolbarBottom: layout.toolbarBottom,
    switchTop: layout.switchTop,
    pass:
      layout.noteHeadSwitch === 3 &&
      layout.switchTop !== null &&
      layout.toolbarBottom !== null &&
      layout.switchTop >= layout.toolbarBottom,
  });

  // C. 源码
  await clickMode(".note-head", "source");
  await sleep(700);
  const src = await snap();
  results.push({
    label: "C. 点「源码」→ 编辑器显示完整语法",
    ...src.main,
    pass:
      src.main.activeMode === "source" &&
      src.main.editor === true &&
      src.main.hiddenMarks === 0 &&
      src.main.markVisible === 0,
  });

  // D. 阅读
  await clickMode(".note-head", "read");
  await sleep(900);
  const rd = await snap();
  results.push({
    label: "D. 点「阅读」→ 变成只读渲染视图",
    ...rd.main,
    pass: rd.main.activeMode === "read" && rd.main.reading === true && rd.main.editor === false,
  });

  // E. 回到编辑
  await clickMode(".note-head", "live");
  await sleep(900);
  const live = await snap();
  results.push({
    label: "E. 点「编辑」→ 回到实时渲染",
    ...live.main,
    pass:
      live.main.activeMode === "live" &&
      live.main.editor === true &&
      live.main.reading === false &&
      live.main.hiddenMarks + live.main.markVisible > 0,
  });

  // F. 分屏里也有自己的一份，且互不影响
  await openNote("笔记B");
  // 拖 笔记B 到右边开分屏
  const box = await js(`(() => {
    const tab = Array.from(document.querySelectorAll('.tabbar-main .tab'))
      .find(e => (e.querySelector('.tab-title')?.textContent || '') === '笔记B');
    if (!tab) return null;
    const r = tab.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  })()`);
  const pane = await js(`(() => {
    const el = document.querySelector('.pane-area');
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  })()`);
  if (box && pane) {
    const to = { x: Math.round(pane.left + pane.width * 0.95), y: Math.round(pane.top + pane.height * 0.5) };
    const mouse = (type, x, y) =>
      cdp("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons: type === "mouseReleased" ? 0 : 1, clickCount: 1 });
    await mouse("mousePressed", box.x, box.y);
    for (let i = 1; i <= 6; i++) {
      await mouse("mouseMoved", Math.round(box.x + ((to.x - box.x) * i) / 6), Math.round(box.y + ((to.y - box.y) * i) / 6));
      await sleep(30);
    }
    await sleep(150);
    await mouse("mouseReleased", to.x, to.y);
    await sleep(1500);
  }

  await clickMode(".split-pane", "read");
  await sleep(1000);
  const both = await snap();
  results.push({
    label: "F. 分屏有独立模式按钮，互不影响",
    mainMode: both.main?.activeMode,
    sideMode: both.side?.activeMode,
    sideReading: both.side?.reading,
    mainReading: both.main?.reading,
    pass: both.side?.activeMode === "read" && both.side?.reading === true && both.main?.reading === false,
  });

  console.log(JSON.stringify(results, null, 2));
  const passed = results.filter((r) => r.pass).length;
  console.log(`\n=== 汇总：${passed}/${results.length} 通过 ===`);
  results.filter((r) => !r.pass).forEach((r) => console.log(`  FAIL ${r.label}`));

  ws.close(); chrome.kill();
  await sleep(500);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
  process.exit(passed === results.length ? 0 : 2);
}
main().catch((e) => { console.error(e.message); process.exit(1); });

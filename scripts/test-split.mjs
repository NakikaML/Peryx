/**
 * 分屏验证：
 *  A. 右键菜单「在分屏打开」能开第二个面板
 *  B. 分屏显示的是与主面板不同的笔记
 *  C. 分屏里能编辑并保存（改内容 → 写盘被调用）
 *  D. 关闭分屏后主面板仍在
 *  E. 分屏有自己的模式切换（阅读态渲染）
 */
import http from "node:http";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9660;
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
  const profile = path.join(process.env.TEMP, "peryx-split-" + Date.now());
  const chrome = spawn(CHROME, [
    "--headless=new", "--disable-gpu", "--no-first-run",
    `--user-data-dir=${profile}`, `--remote-debugging-port=${PORT}`,
    "--window-size=1400,900", "http://localhost:1420/preview.html?page=split",
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

  // 先打开第一篇笔记作为主面板
  await js(`(() => {
    const i = Array.from(document.querySelectorAll('.tree-item'))
      .find(e => (e.textContent || '').includes('笔记A'));
    if (i) i.click();
    return true;
  })()`);
  await sleep(900);

  // A. 右键 → 在分屏打开
  const opened = await js(`(() => {
    const item = Array.from(document.querySelectorAll('.tree-item'))
      .find(e => (e.textContent || '').includes('笔记B'));
    if (!item) return { err: '找不到笔记B' };
    const r = item.getBoundingClientRect();
    item.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true, cancelable: true,
      clientX: Math.round(r.left + 20), clientY: Math.round(r.top + 8),
    }));
    return { ok: true };
  })()`);

  await sleep(600);
  const menuHas = await js(`(() => {
    const btns = Array.from(document.querySelectorAll('.tree-menu button, .ctx-menu button, [class*="menu"] button'));
    const target = btns.find(b => (b.textContent || '').includes('在分屏打开'));
    if (target) { target.click(); return true; }
    return false;
  })()`);
  await sleep(1500);

  const splitState = await js(`(() => {
    const panes = document.querySelectorAll('.split-pane');
    const editors = document.querySelectorAll('.cm-editor');
    const title = document.querySelector('.split-title')?.textContent ?? null;
    return { paneCount: panes.length, editorCount: editors.length, title };
  })()`);

  results.push({
    label: "A. 右键「在分屏打开」能打开第二个面板",
    menuItem: menuHas,
    ...splitState,
    pass: menuHas === true && splitState.paneCount === 1 && splitState.editorCount === 2,
  });

  results.push({
    label: "B. 分屏标题是另一篇笔记",
    title: splitState.title,
    pass: (splitState.title || "").includes("笔记B"),
  });

  // C. 在分屏里输入 → 触发 write_note
  const typed = await js(`(() => {
    const editors = Array.from(document.querySelectorAll('.cm-editor'));
    const splitEditor = editors[editors.length - 1];
    const cm = splitEditor.querySelector('.cm-content');
    if (!cm) return { err: '没有分屏编辑器' };
    cm.focus();
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(cm);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
    return { ok: true };
  })()`);
  void typed;
  await cdp("Input.insertText", { text: "分屏输入测试" });
  await sleep(1600);

  const wrote = await js(`(window.__SPLIT_WRITES__ || []).slice(-3)`);
  results.push({
    label: "C. 分屏里编辑会写盘",
    writes: wrote,
    pass: Array.isArray(wrote) && wrote.some((x) => String(x.text || "").includes("分屏输入测试")),
  });

  // E. 切到阅读模式（分屏自己的模式按钮在 split-head 里）
  await js(`(() => {
    const pane = document.querySelector('.split-pane');
    const btn = pane.querySelector('.split-head .pane-mode-btn[data-mode="read"]');
    if (btn) btn.click();
    return true;
  })()`);
  await sleep(1200);
  const reading = await js(`(() => {
    const pane = document.querySelector('.split-pane');
    return {
      readingShown: !!pane.querySelector('.reading-view'),
      editorGone: !pane.querySelector('.cm-editor'),
    };
  })()`);
  results.push({
    label: "E. 分屏可切到阅读模式",
    ...reading,
    pass: reading.readingShown === true && reading.editorGone === true,
  });

  // F. 布局顺序：主编辑区 → 分屏 → 右侧边栏
  const order = await js(`(() => {
    const ws = document.querySelector('.workspace');
    const pane = document.querySelector('.pane-area');
    if (!ws) return { err: '没有 workspace', cls: [] };
    const wsCls = Array.from(ws.children).map(function (k) { return String(k.className || ''); });
    const paneCls = pane ? Array.from(pane.children).map(function (k) { return String(k.className || ''); }) : [];
    return {
      wsCls: wsCls,
      cls: paneCls,
      editor: paneCls.findIndex(function (c) { return c.indexOf('editor-wrap') >= 0; }),
      split: paneCls.findIndex(function (c) { return c.indexOf('split-pane') >= 0; }),
      // 右侧边栏现在在 pane-area 之外（最外层）
      right: wsCls.findIndex(function (c) { return c.indexOf('right-sidebar') >= 0; }),
      rightInPane: paneCls.some(function (c) { return c.indexOf('right-sidebar') >= 0; }),
    };
  })()`);
  results.push({
    label: "F. 分屏在中间，右侧边栏仍在最右",
    ...order,
    pass:
      order.editor >= 0 &&
      order.split > order.editor &&
      order.rightInPane === false &&
      order.right >= 0,
  });
  // D. 关闭分屏
  await js(`(() => {
    const pane = document.querySelector('.split-pane');
    const btn = pane.querySelector('.tabbar-pane-close');
    if (btn) btn.click();
    return true;
  })()`);
  await sleep(1000);
  const closed = await js(`({
    paneCount: document.querySelectorAll('.split-pane').length,
    editorCount: document.querySelectorAll('.cm-editor').length,
  })`);
  results.push({
    label: "D. 关闭分屏后主面板仍在",
    ...closed,
    pass: closed.paneCount === 0 && closed.editorCount === 1,
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

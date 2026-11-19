/**
 * 逐条验证用户反馈的 8 个问题。
 *
 * 1. 光标在标题行 → 应显示 ###
 * 2. 光标在加粗文本内 → 应显示 **
 * 3. 行内公式：点击后应能编辑内部（光标能落在 $ 之间）
 * 4. 块级公式：光标在块内 → 应隐藏渲染预览，显示源码
 * 5. 任务复选框：点击应切换勾选状态
 * 6. 表格：应有表头样式（加粗）
 * 7. 光标在引用行 → 应显示 >
 * 8. 链接：Ctrl+点击应能跳转（这里只验证能识别到 URL）
 */
import http from "node:http";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9360;

function get(port, p) {
  return new Promise((res, rej) => {
    http.get({ host: "127.0.0.1", port, path: p }, (r) => {
      let d = "";
      r.on("data", (c) => (d += c));
      r.on("end", () => res(JSON.parse(d)));
    }).on("error", rej);
  });
}

async function main() {
  const profile = path.join(process.env.TEMP, "peryx-8-" + Date.now());
  const chrome = spawn(CHROME, [
    "--headless=new", "--disable-gpu", "--no-first-run",
    `--user-data-dir=${profile}`, `--remote-debugging-port=${PORT}`,
    "--window-size=1400,1200", "http://localhost:1420/preview.html",
  ], { stdio: "ignore" });

  let t = null;
  for (let i = 0; i < 80; i++) {
    await new Promise((r) => setTimeout(r, 250));
    try { t = await get(PORT, "/json/list"); if (t?.length) break; } catch {}
  }
  const ws = new WebSocket(t.find((x) => x.type === "page").webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let seq = 0;
  const waiters = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && waiters.has(m.id)) { waiters.get(m.id)(m); waiters.delete(m.id); } };
  const cdp = (method, params = {}) => new Promise((r) => { const id = ++seq; waiters.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
  const js = async (expr) => {
    const res = await cdp("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
    if (res.result?.exceptionDetails) throw new Error(res.result.exceptionDetails.exception?.description || "err");
    return res.result?.result?.value;
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  for (let i = 0; i < 80; i++) {
    if (await js("!!(window.__EDITOR_HANDLE__ && window.__EDITOR_HANDLE__.view)")) break;
    await sleep(250);
  }
  await sleep(1800);

  const results = [];

  /** 把光标放到指定行，然后检查该行 DOM */
  async function checkLine(needle, label, offsetInLine = 3) {
    const info = await js(`(() => {
      const v = window.__EDITOR_HANDLE__.view;
      const doc = v.state.doc;
      let lineNo = -1;
      for (let i = 1; i <= doc.lines; i++) {
        if (doc.line(i).text.includes(${JSON.stringify(needle)})) { lineNo = i; break; }
      }
      if (lineNo < 0) return { err: 'not found' };
      const line = doc.line(lineNo);
      v.dispatch({ selection: { anchor: Math.min(line.from + ${offsetInLine}, line.to) } });
      return { lineNo };
    })()`);
    if (info.err) return { label, pass: false, reason: "找不到目标行" };
    await sleep(450);

    const dom = await js(`(() => {
      const v = window.__EDITOR_HANDLE__.view;
      const lineNo = v.state.doc.lineAt(v.state.selection.main.head).number;
      const els = document.querySelectorAll('.cm-line');
      // 找到对应行元素：通过行号索引
      let el = null;
      // cm-line 按文档顺序排列，但可能只渲染视口内的
      const all = Array.from(els);
      // 用 vertical 位置匹配：直接取包含目标文本的第一个
      for (const e of all) {
        if (e.textContent.includes(${JSON.stringify(needle.slice(0, 6))})) { el = e; break; }
      }
      if (!el) return { err: 'no element' };
      const hidden = el.querySelectorAll('.cm-mark-hidden').length;
      const visible = el.querySelectorAll('.cm-mark-visible').length;
      return {
        text: el.textContent.slice(0, 60),
        hiddenCount: hidden,
        visibleCount: visible,
        rawHTML: el.innerHTML.slice(0, 300),
      };
    })()`);
    return { label, ...dom };
  }

  // ---- 1. 标题 ----
  const h1 = await checkLine("微积分基础：导数与积分", "1. 标题显示 ###", 2);
  results.push({ ...h1, pass: h1.visibleCount > 0 });

  // ---- 2. 加粗 ----
  const bold = await checkLine("栖知", "2. 加粗显示 **", 8);
  results.push({ ...bold, pass: bold.visibleCount > 0 });

  // ---- 3. 行内公式可编辑 ----
  const inline = await checkLine("$f(x)$", "3. 行内公式展开源码", 12);
  results.push({ ...inline, pass: inline.text && inline.text.includes("$f(x)$") });

  // ---- 4. 块级公式：编辑时光标进入，下方渲染仍保留 ----
  const blockMath = await js(`(() => {
    const v = window.__EDITOR_HANDLE__.view;
    const doc = v.state.doc;
    let ln = -1;
    for (let i = 1; i <= doc.lines; i++) if (doc.line(i).text.trim().startsWith('$$')) { ln = i; break; }
    if (ln < 0) return { err: 'no $$ line' };
    const before = document.querySelectorAll('.cm-formula-preview').length;
    v.dispatch({ selection: { anchor: doc.line(ln).from + 3 } });
    return { ln, previewsBefore: before };
  })()`);
  await sleep(500);
  const blockMathAfter = await js(`document.querySelectorAll('.cm-formula-preview').length`);
  results.push({
    label: "4. 编辑块级公式时下方渲染保留",
    previewsBefore: blockMath.previewsBefore,
    previewsAfter: blockMathAfter,
    pass: blockMathAfter >= blockMath.previewsBefore && blockMathAfter > 0,
  });

  // ---- 5. 任务复选框点击（用真实鼠标事件）----
  const boxPos = await js(`(() => {
    const boxes = document.querySelectorAll('.cm-task-checkbox');
    if (!boxes.length) return { err: 'no checkbox' };
    const r = boxes[0].getBoundingClientRect();
    if (r.width === 0) {
      // 可能在视口外，先滚动
      boxes[0].scrollIntoView({ block: 'center' });
      return { needScroll: true };
    }
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), count: boxes.length };
  })()`);
  if (boxPos.needScroll) {
    await sleep(400);
  }
  const boxPos2 = await js(`(() => {
    const boxes = document.querySelectorAll('.cm-task-checkbox');
    if (!boxes.length) return { err: 'no checkbox after scroll' };
    boxes[0].scrollIntoView({ block: 'center' });
    return { ready: true, count: boxes.length };
  })()`);
  await sleep(400);

  const boxCoords = await js(`(() => {
    const boxes = document.querySelectorAll('.cm-task-checkbox');
    if (!boxes.length) return { err: 'gone' };
    const r = boxes[0].getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), count: boxes.length };
  })()`);

  let taskChanged = false;
  if (boxCoords.x) {
    const before = await js(`window.__EDITOR_HANDLE__.view.state.doc.toString()`);
    await cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: boxCoords.x, y: boxCoords.y });
    await cdp("Input.dispatchMouseEvent", { type: "mousePressed", x: boxCoords.x, y: boxCoords.y, button: "left", buttons: 1, clickCount: 1 });
    await cdp("Input.dispatchMouseEvent", { type: "mouseReleased", x: boxCoords.x, y: boxCoords.y, button: "left", buttons: 0, clickCount: 1 });
    await sleep(450);
    const after = await js(`window.__EDITOR_HANDLE__.view.state.doc.toString()`);
    taskChanged = before !== after;
  }

  results.push({
    label: "5. 任务复选框可点击切换",
    count: boxCoords.count,
    changed: taskChanged,
    pass: taskChanged,
  });

  // ---- 6. 表格：渲染为真正的 HTML 表格，表头加粗 ----
  const table = await js(`(() => {
    // 先把光标移开，让表格处于渲染态
    const v = window.__EDITOR_HANDLE__.view;
    v.dispatch({ selection: { anchor: v.state.doc.length } });
    return { ok: true };
  })()`);
  void table;
  await sleep(500);
  const tableInfo = await js(`(() => {
    const ths = document.querySelectorAll('.cm-table-element th');
    const tds = document.querySelectorAll('.cm-table-element td');
    const widget = document.querySelector('.cm-table-widget');
    const cs = ths[0] ? getComputedStyle(ths[0]) : null;
    return {
      hasTableElement: !!document.querySelector('table.cm-table-element'),
      thCount: ths.length,
      tdCount: tds.length,
      headFontWeight: cs ? cs.fontWeight : null,
      headBg: cs ? cs.backgroundColor : null,
      hasWidget: !!widget,
    };
  })()`);
  results.push({
    label: "6. 表格渲染为 HTML 表格且表头加粗",
    ...tableInfo,
    pass:
      tableInfo.hasTableElement &&
      tableInfo.thCount > 0 &&
      parseInt(tableInfo.headFontWeight || "400") >= 600,
  });

  // ---- 7. 引用显示 > ----
  const quote = await checkLine("引用：数学是研究", "7. 引用显示 >", 4);
  results.push({ ...quote, pass: quote.visibleCount > 0 });

  // ---- 8. 链接识别 ----
  const link = await js(`(() => {
    const v = window.__EDITOR_HANDLE__.view;
    const doc = v.state.doc;
    let ln = -1;
    for (let i = 1; i <= doc.lines; i++) if (doc.line(i).text.includes('这是一个链接')) { ln = i; break; }
    if (ln < 0) return { err: 'no link line' };
    const line = doc.line(ln);
    // 检查编辑器上是否注册了 linkClickHandler（间接验证：找到链接元素）
    const linkEls = document.querySelectorAll('.cm-link-text');
    return { ln, linkTextCount: linkEls.length };
  })()`);
  results.push({
    label: "8. 链接文字可识别",
    linkTextCount: link.linkTextCount,
    pass: link.linkTextCount > 0,
  });

  console.log(JSON.stringify(results, null, 2));
  console.log("\n=== 汇总 ===");
  const passed = results.filter((r) => r.pass).length;
  console.log(`${passed}/${results.length} 通过`);
  results.filter((r) => !r.pass).forEach((r) => console.log(`  ❌ ${r.label}${r.err ? " — " + r.err : ""}`));

  ws.close(); chrome.kill();
  await sleep(500);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
}
main().catch((e) => { console.error(e.message); process.exit(1); });

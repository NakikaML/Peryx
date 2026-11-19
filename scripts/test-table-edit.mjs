/**
 * 验证 Obsidian 风格的表格就地编辑：
 *  - 表格始终渲染（不会切回源码）
 *  - 点击单元格 → 可编辑（原始 Markdown 文本）
 *  - 编辑后失焦 → 内容写回 Markdown
 */
import http from "node:http";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9370;

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
  const profile = path.join(process.env.TEMP, "peryx-tb-" + Date.now());
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

  // 1. 表格是否始终渲染（即使光标在表格内）
  const always = await js(`(() => {
    const v = window.__EDITOR_HANDLE__.view;
    const doc = v.state.doc;
    // 找到表格第一行
    let ln = -1;
    for (let i = 1; i <= doc.lines; i++) if (doc.line(i).text.trim().startsWith('|')) { ln = i; break; }
    if (ln < 0) return { err: 'no table' };
    // 光标放进表格
    v.dispatch({ selection: { anchor: doc.line(ln).from + 3 } });
    return { ln };
  })()`);
  await sleep(600);
  const afterCursorInTable = await js(`({
    tableExists: !!document.querySelector('table.cm-table-element'),
    editableCells: document.querySelectorAll('[contenteditable="true"]').length,
  })`);
  results.push({
    label: "1. 光标在表格内时仍然渲染",
    ...afterCursorInTable,
    pass: afterCursorInTable.tableExists && afterCursorInTable.editableCells > 0,
  });

  // 2. 点击单元格 → 内容变成原始 Markdown
  const focusResult = await js(`(() => {
    const cell = document.querySelector('tbody td[contenteditable], thead th[contenteditable]');
    if (!cell) return { err: 'no cell' };
    cell.focus();
    return {
      focused: document.activeElement === cell,
      textAfterFocus: cell.textContent,
      raw: cell.dataset.raw,
    };
  })()`);
  await sleep(300);
  results.push({
    label: "2. 聚焦单元格显示原始 Markdown",
    ...focusResult,
    pass: focusResult.focused && focusResult.textAfterFocus === focusResult.raw,
  });

  // 2b. 真实鼠标点击单元格
  const cellPos = await js(`(() => {
    const cell = document.querySelector('tbody td[contenteditable]');
    if (!cell) return { err: 'no cell' };
    cell.scrollIntoView({ block: 'center' });
    return { ok: true };
  })()`);
  void cellPos;
  await sleep(500);
  const coords = await js(`(() => {
    const cell = document.querySelector('tbody td[contenteditable]');
    if (!cell) return { err: 'no cell' };
    const r = cell.getBoundingClientRect();
    return {
      x: Math.round(r.left + r.width / 2),
      y: Math.round(r.top + r.height / 2),
      raw: cell.dataset.raw,
    };
  })()`);
  let clickedOk = false;
  let clickedText = "";
  if (coords.x) {
    await cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: coords.x, y: coords.y });
    await cdp("Input.dispatchMouseEvent", { type: "mousePressed", x: coords.x, y: coords.y, button: "left", buttons: 1, clickCount: 1 });
    await cdp("Input.dispatchMouseEvent", { type: "mouseReleased", x: coords.x, y: coords.y, button: "left", buttons: 0, clickCount: 1 });
    await sleep(500);
    const after = await js(`(() => {
      const cell = document.querySelector('tbody td[contenteditable]');
      return {
        isActive: document.activeElement === cell,
        text: cell ? cell.textContent : '',
        raw: cell ? cell.dataset.raw : '',
      };
    })()`);
    clickedOk = after.isActive && after.text === after.raw;
    clickedText = after.text;
  }
  results.push({
    label: "2b. 真实鼠标点击进入单元格编辑",
    clicked: clickedOk,
    cellText: clickedText,
    pass: clickedOk,
  });

  // 3. 修改内容并失焦 → 写回 Markdown
  const editResult = await js(`(() => {
    const v = window.__EDITOR_HANDLE__.view;
    const before = v.state.doc.toString();
    const cells = document.querySelectorAll('tbody td[contenteditable]');
    const cell = cells[0];
    if (!cell) return { err: 'no body cell' };
    cell.focus();
    cell.textContent = '测试修改';
    cell.dispatchEvent(new Event('input', { bubbles: true }));
    cell.blur();
    return {
      before: before.includes('函数') ? 'has 函数' : 'no 函数',
      afterDoc: v.state.doc.toString().includes('测试修改'),
    };
  })()`);
  await sleep(700);
  const editCheck = await js(`(() => {
    const v = window.__EDITOR_HANDLE__.view;
    const doc = v.state.doc.toString();
    return {
      docHasNewText: doc.includes('测试修改'),
      tableStillRendered: !!document.querySelector('table.cm-table-element'),
      cellShowsNewText: (document.querySelector('tbody td')?.textContent || '').includes('测试修改'),
    };
  })()`);
  results.push({
    label: "3. 编辑后写回 Markdown 并重新渲染",
    ...editCheck,
    pass: editCheck.docHasNewText && editCheck.tableStillRendered,
  });

  console.log(JSON.stringify(results, null, 2));
  const passed = results.filter((r) => r.pass).length;
  console.log(`\n=== 汇总：${passed}/${results.length} 通过 ===`);
  results.filter((r) => !r.pass).forEach((r) => console.log(`  ❌ ${r.label}${r.err ? " — " + r.err : ""}`));

  ws.close(); chrome.kill();
  await sleep(500);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
  process.exit(passed === results.length ? 0 : 2);
}
main().catch((e) => { console.error(e.message); process.exit(1); });

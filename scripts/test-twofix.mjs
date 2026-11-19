/**
 * 验证两个回归 bug 的修复：
 *  A. 行内公式编辑时，不应在下方出现额外的预览条
 *  B. 表格单元格之间切换时，失焦的单元格应恢复为渲染态（不能残留源码）
 */
import http from "node:http";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9380;

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
  const profile = path.join(process.env.TEMP, "peryx-fix-" + Date.now());
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

  // ---- A. 行内公式编辑时不应有额外预览条 ----
  await js(`(() => {
    const v = window.__EDITOR_HANDLE__.view;
    const doc = v.state.doc;
    for (let i = 1; i <= doc.lines; i++) {
      if (doc.line(i).text.includes('$f(x)$')) {
        v.dispatch({ selection: { anchor: doc.line(i).from + 10 }, scrollIntoView: true });
        return;
      }
    }
  })()`);
  await sleep(600);
  const inlineState = await js(`({
    inlineMathWidgets: document.querySelectorAll('.cm-inline-math').length,
    linePreviewStrips: document.querySelectorAll('.cm-inline-math-preview').length,
    blockFormulaPreviews: document.querySelectorAll('.cm-formula-preview').length,
    showsDollarSource: (() => {
      for (const e of document.querySelectorAll('.cm-line')) if (e.textContent.includes('$f(x)$')) return true;
      return false;
    })(),
  })`);
  results.push({
    label: "A. 行内公式编辑时无额外预览条",
    ...inlineState,
    pass:
      inlineState.showsDollarSource &&
      inlineState.linePreviewStrips === 0 &&
      inlineState.blockFormulaPreviews > 0,
  });

  // ---- B. 表格单元格切换后应恢复渲染态 ----
  // 先把光标移出文档，让表格稳定渲染
  await js(`(() => {
    const v = window.__EDITOR_HANDLE__.view;
    v.dispatch({ selection: { anchor: v.state.doc.length } });
  })()`);
  await sleep(500);

  const cells = await js(`(() => {
    const list = Array.from(document.querySelectorAll('tbody td[contenteditable]'));
    list.forEach(c => c.scrollIntoView({ block: 'center' }));
    return list.length;
  })()`);
  await sleep(500);

  // 聚焦第 1 个单元格
  const first = await js(`(() => {
    const c = document.querySelectorAll('tbody td[contenteditable]')[0];
    if (!c) return { err: 'no cell' };
    const r = c.getBoundingClientRect();
    return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2),
             raw: c.dataset.raw };
  })()`);

  if (first.x) {
    await cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: first.x, y: first.y });
    await cdp("Input.dispatchMouseEvent", { type: "mousePressed", x: first.x, y: first.y, button: "left", buttons: 1, clickCount: 1 });
    await cdp("Input.dispatchMouseEvent", { type: "mouseReleased", x: first.x, y: first.y, button: "left", buttons: 0, clickCount: 1 });
    await sleep(450);
  }

  const afterFirstClick = await js(`(() => {
    const c = document.querySelectorAll('tbody td[contenteditable]')[0];
    return {
      isEditing: c?.dataset.editing === '1',
      text: c?.textContent,
      raw: c?.dataset.raw,
    };
  })()`);

  // 再点第 2 个单元格
  const second = await js(`(() => {
    const c = document.querySelectorAll('tbody td[contenteditable]')[1];
    if (!c) return { err: 'no second cell' };
    const r = c.getBoundingClientRect();
    return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2),
             raw: c.dataset.raw };
  })()`);

  if (second.x) {
    await cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: second.x, y: second.y });
    await cdp("Input.dispatchMouseEvent", { type: "mousePressed", x: second.x, y: second.y, button: "left", buttons: 1, clickCount: 1 });
    await cdp("Input.dispatchMouseEvent", { type: "mouseReleased", x: second.x, y: second.y, button: "left", buttons: 0, clickCount: 1 });
  }

  await sleep(600);

  const afterSecondClick = await js(`(() => {
    const list = document.querySelectorAll('tbody td[contenteditable]');
    const c1 = list[0];
    const c2 = list[1];
    return {
      cell1Text: c1?.textContent,
      cell1Raw: c1?.dataset.raw,
      // 第 1 个单元格不应残留源码：文本应等于渲染后的文本（不含 $ 符号）
      cell1HasDollar: (c1?.textContent ?? '').includes('$'),
      cell2Editing: c2?.dataset.editing === '1',
      cell2Text: c2?.textContent,
    };
  })()`);

  results.push({
    label: "B. 切换单元格后原单元格恢复渲染态",
    cells,
    afterFirstClick,
    afterSecondClick,
    pass:
      afterSecondClick.cell1HasDollar === false &&
      afterSecondClick.cell2Editing === true,
  });

  console.log(JSON.stringify(results, null, 2));
  const passed = results.filter((r) => r.pass).length;
  console.log(`\n=== 汇总：${passed}/${results.length} 通过 ===`);
  results.filter((r) => !r.pass).forEach((r) => console.log(`  ❌ ${r.label}`));

  ws.close(); chrome.kill();
  await sleep(500);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
  process.exit(passed === results.length ? 0 : 2);
}
main().catch((e) => { console.error(e.message); process.exit(1); });

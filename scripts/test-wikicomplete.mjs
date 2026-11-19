/**
 * 验证 [[ 自动补全：
 *  A. 输入 [[ 后弹出补全列表
 *  B. 列表包含已有笔记标题
 *  C. 选中后补成 [[标题]]，光标在 ]] 之后
 *  D. 输入部分文字后能过滤
 */
import http from "node:http";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9532;
const PAGE = "http://localhost:1420/preview.html?page=wikilink";

function get(port, p) {
  return new Promise((res, rej) => {
    http.get({ host: "127.0.0.1", port, path: p }, (r) => {
      let d = "";
      r.on("data", (c) => (d += c));
      r.on("end", () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } });
    }).on("error", rej);
  });
}

async function main() {
  const profile = path.join(process.env.TEMP, "peryx-cmp-" + Date.now());
  const chrome = spawn(CHROME, [
    "--headless=new", "--disable-gpu", "--no-first-run",
    `--user-data-dir=${profile}`, `--remote-debugging-port=${PORT}`,
    "--window-size=1200,900", PAGE,
  ], { stdio: "ignore" });

  let t = null;
  for (let i = 0; i < 80; i++) {
    await new Promise((r) => setTimeout(r, 250));
    try { t = await get(PORT, "/json/list"); if (t?.length) break; } catch {}
  }
  if (!t) { console.error("无法连接 Chrome"); process.exit(1); }
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

  // 在文档末尾新起一行，输入 [[
  const typed = await js(`(() => {
    const v = window.__EDITOR_HANDLE__.view;
    v.focus();
    const end = v.state.doc.length;
    v.dispatch({ changes: { from: end, insert: '\\n' }, selection: { anchor: end + 1 } });
    return { ok: true };
  })()`);
  void typed;
  await sleep(300);

  // 用真实键盘输入 [[
  await js(`window.__EDITOR_HANDLE__.view.focus()`);
  await cdp("Input.insertText", { text: "[[" });
  await sleep(800);

  const afterTyping = await js(`(() => {
    const tip = document.querySelector('.cm-tooltip-autocomplete');
    const options = Array.from(document.querySelectorAll('.cm-completionLabel')).map(e => e.textContent);
    return {
      tooltipOpen: !!tip,
      optionCount: options.length,
      options: options.slice(0, 10),
      docTail: window.__EDITOR_HANDLE__.view.state.doc.toString().slice(-20),
    };
  })()`);

  results.push({
    label: "A. 输入 [[ 后弹出补全列表",
    ...afterTyping,
    pass: afterTyping.tooltipOpen && afterTyping.optionCount > 0,
  });

  results.push({
    label: "B. 候选里包含已有笔记",
    options: afterTyping.options,
    pass: afterTyping.options.length > 0,
  });

  // 选中第一条（回车）
  await cdp("Input.dispatchKeyEvent", { type: "rawKeyDown", windowsVirtualKeyCode: 13, key: "Enter", code: "Enter" });
  await cdp("Input.dispatchKeyEvent", { type: "keyUp", windowsVirtualKeyCode: 13, key: "Enter", code: "Enter" });
  await sleep(700);

  const afterAccept = await js(`(() => {
    const v = window.__EDITOR_HANDLE__.view;
    const doc = v.state.doc.toString();
    const tail = doc.slice(-40);
    const head = v.state.selection.main.head;
    const afterCursor = doc.slice(head, head + 4);
    return {
      tail,
      cursorAfter: afterCursor,
      wellFormed: /\\[\\[[^\\]\\n]+\\]\\]/.test(tail),
    };
  })()`);

  results.push({
    label: "C. 补全结果为 [[标题]] 且光标在 ]] 之后",
    ...afterAccept,
    pass: afterAccept.wellFormed && afterAccept.cursorAfter.indexOf("]]") !== 0,
  });

  // D. 过滤：清空后再输入 [[微积
  await js(`(() => {
    const v = window.__EDITOR_HANDLE__.view;
    const doc = v.state.doc;
    // 删掉最后一行
    const last = doc.line(doc.lines);
    v.dispatch({ changes: { from: last.from, to: doc.length, insert: '' }, selection: { anchor: last.from } });
    v.focus();
    return true;
  })()`);
  await sleep(300);
  await cdp("Input.insertText", { text: "[[微积" });
  await sleep(900);

  const filtered = await js(`(() => {
    const options = Array.from(document.querySelectorAll('.cm-completionLabel')).map(e => e.textContent);
    return { optionCount: options.length, options: options.slice(0, 5) };
  })()`);

  results.push({
    label: "D. 输入部分文字后过滤候选",
    ...filtered,
    pass: filtered.optionCount > 0 && filtered.options.every((o) => o.includes("微积") || o.includes("微积分")),
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

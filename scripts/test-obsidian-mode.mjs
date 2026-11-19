/**
 * 验证「光标进入行内公式所在行时，公式展开为源码」这一交互。
 */
import http from "node:http";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9352;

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
  const profile = path.join(process.env.TEMP, "peryx-exp-" + Date.now());
  const chrome = spawn(CHROME, [
    "--headless=new", "--disable-gpu", "--no-first-run",
    `--user-data-dir=${profile}`, `--remote-debugging-port=${PORT}`,
    "--window-size=1400,1050", "http://localhost:1420/preview.html",
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
  await sleep(1500);

  // 找到含行内公式的行
  const lineNo = await js(`(() => {
    const doc = window.__EDITOR_HANDLE__.view.state.doc;
    for (let i = 1; i <= doc.lines; i++) if (doc.line(i).text.includes('$f(x)$')) return i;
    return -1;
  })()`);

  // 状态 A：光标在文档末尾（该行未激活 → 应渲染）
  await js(`(() => {
    const v = window.__EDITOR_HANDLE__.view;
    v.dispatch({ selection: { anchor: v.state.doc.length } });
  })()`);
  await sleep(500);

  const stateA = await js(`(() => {
    const els = document.querySelectorAll('.cm-line');
    const el = els[${lineNo} - 1];
    return {
      inlineMathWidgets: document.querySelectorAll('.cm-inline-math').length,
      hasDollarInText: el ? el.textContent.includes('$f(x)$') : null,
      lineText: el ? el.textContent.slice(0, 50) : null,
    };
  })()`);

  // 状态 B：光标进入该行（应展开源码）
  await js(`(() => {
    const v = window.__EDITOR_HANDLE__.view;
    v.dispatch({ selection: { anchor: v.state.doc.line(${lineNo}).from + 3 } });
  })()`);
  await sleep(500);

  const stateB = await js(`(() => {
    const els = document.querySelectorAll('.cm-line');
    const el = els[${lineNo} - 1];
    return {
      inlineMathWidgets: document.querySelectorAll('.cm-inline-math').length,
      hasDollarInText: el ? el.textContent.includes('$f(x)$') : null,
      lineText: el ? el.textContent.slice(0, 50) : null,
    };
  })()`);

  console.log("=== 光标不在该行（应为渲染状态）===");
  console.log(JSON.stringify(stateA, null, 2));
  console.log("\n=== 光标进入该行（应展开源码）===");
  console.log(JSON.stringify(stateB, null, 2));

  const pass = stateA.inlineMathWidgets > 0 && !stateA.hasDollarInText && stateB.hasDollarInText;
  console.log(`\n=== 交互验证：${pass ? "✅ 通过" : "❌ 失败"} ===`);

  ws.close(); chrome.kill();
  await sleep(500);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
  process.exit(pass ? 0 : 2);
}
main().catch((e) => { console.error(e.message); process.exit(1); });

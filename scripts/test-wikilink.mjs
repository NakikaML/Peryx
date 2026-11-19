/**
 * 验证 [[双链]] 渲染：
 *  A. 正文里的双链渲染为 .cm-wikilink；代码块 / 行内代码里的保持原样
 *  B. 别名语法 [[目标|别名]] 显示别名
 *  C. 目标不存在的链接带「待创建」样式
 *  D. 光标进入该行 → 显示 [[ 源码
 */
import http from "node:http";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9531;
const PAGE = "http://localhost:1420/preview.html?page=wikilink";

function get(port, p) {
  return new Promise((res, rej) => {
    http.get({ host: "127.0.0.1", port, path: p }, (r) => {
      let d = "";
      r.on("data", (c) => (d += c));
      r.on("end", () => {
        try { res(JSON.parse(d)); } catch (e) { rej(e); }
      });
    }).on("error", rej);
  });
}

async function main() {
  const profile = path.join(process.env.TEMP, "peryx-wiki-" + Date.now());
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

  // 光标移到最后，让含链接的行处于渲染态
  await js(`(() => {
    const v = window.__EDITOR_HANDLE__.view;
    v.dispatch({ selection: { anchor: v.state.doc.length } });
  })()`);
  await sleep(700);

  const rendered = await js(`(() => {
    const links = Array.from(document.querySelectorAll('.cm-wikilink'));
    const allText = Array.from(document.querySelectorAll('.cm-line')).map(e => e.textContent).join('\\n');
    return {
      count: links.length,
      texts: links.map(e => e.textContent),
      classes: links.map(e => e.className),
      targets: links.map(e => e.dataset.wikiTarget),
      inlineCodeKept: allText.indexOf('[[' + String.fromCharCode(0x4e0d)) >= 0,
      fencedCodeKept: allText.includes('\\u4ee3\\u7801\\u5757\\u91cc\\u7684\\u94fe\\u63a5'),
    };
  })()`);

  const expected = ["微积分基础", "别名文字", "民法典导论", "还没有的笔记"];

  results.push({
    label: "A. 正文双链渲染、代码里的不渲染",
    ...rendered,
    pass:
      JSON.stringify(rendered.texts) === JSON.stringify(expected) &&
      rendered.inlineCodeKept &&
      rendered.fencedCodeKept,
  });

  results.push({
    label: "B. 别名语法显示别名",
    texts: rendered.texts,
    pass: rendered.texts.includes("别名文字"),
  });

  const missing = rendered.classes.filter((c) => c.includes("missing")).length;
  results.push({
    label: "C. 目标不存在时带待创建样式",
    missingCount: missing,
    pass: missing === 1,
  });

  // D. 光标进入该行 → 显示源码
  await js(`(() => {
    const v = window.__EDITOR_HANDLE__.view;
    const doc = v.state.doc;
    for (let i = 1; i <= doc.lines; i++) {
      if (doc.line(i).text.indexOf('[[') >= 0) {
        v.dispatch({ selection: { anchor: doc.line(i).from + 2 } });
        return;
      }
    }
  })()`);
  await sleep(700);

  const source = await js(`(() => {
    const lines = Array.from(document.querySelectorAll('.cm-line'));
    return {
      hasSourceBrackets: lines.some(e => e.textContent.indexOf('[[') >= 0),
      wikilinkCount: document.querySelectorAll('.cm-wikilink').length,
    };
  })()`);

  results.push({
    label: "D. 光标进入后显示源码",
    ...source,
    pass: source.hasSourceBrackets,
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

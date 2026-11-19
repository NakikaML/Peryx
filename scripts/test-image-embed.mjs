/**
 * 验证 ![[图片]] 内嵌显示：
 *  A. 渲染为 <img> 且 src 是 data: URL
 *  B. 图片不存在时显示失败占位，不影响其它内容
 *  C. 光标进入该行时显示 ![[源码]]
 *  D. 代码块里的 ![[...]] 不被渲染
 */
import http from "node:http";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9540;
const PAGE = "http://localhost:1420/preview.html?page=image";

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
  const profile = path.join(process.env.TEMP, "peryx-img-" + Date.now());
  const chrome = spawn(CHROME, [
    "--headless=new", "--disable-gpu", "--no-first-run",
    `--user-data-dir=${profile}`, `--remote-debugging-port=${PORT}`,
    "--window-size=1100,900", PAGE,
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
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && waiters.has(m.id)) { waiters.get(m.id)(m); waiters.delete(m.id); }
  };
  const cdp = (method, params = {}) =>
    new Promise((r) => { const id = ++seq; waiters.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
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

  // 光标移出，让图片处于渲染态
  await js(`(() => {
    const v = window.__EDITOR_HANDLE__.view;
    v.dispatch({ selection: { anchor: v.state.doc.length } });
  })()`);
  await sleep(1200);

  const imgs = await js(`(() => {
    const list = Array.from(document.querySelectorAll('.cm-embed-img'));
    const failed = Array.from(document.querySelectorAll('.cm-embed-failed'));
    return {
      imgCount: list.length,
      srcs: list.map(e => e.src.slice(0, 30)),
      allDataUrl: list.every(e => e.src.startsWith('data:image/')),
      dimensions: list.map(e => ({ w: e.naturalWidth, h: e.naturalHeight })),
      failedCount: failed.length,
      failedText: failed.map(e => e.textContent),
    };
  })()`);

  results.push({
    label: "A. 内嵌图片渲染为 data URL 的 img",
    ...imgs,
    pass: imgs.imgCount === 2 && imgs.allDataUrl && imgs.dimensions.every((d) => d.w > 0),
  });

  results.push({
    label: "B. 缺失图片显示失败占位",
    failedCount: imgs.failedCount,
    failedText: imgs.failedText,
    pass: imgs.failedCount === 1,
  });

  // D. 代码块里的不渲染（应在第一轮统计里就不计入）
  const codeKept = await js(`(() => {
    const all = Array.from(document.querySelectorAll('.cm-line')).map(e => e.textContent).join('\\n');
    return all.indexOf('![[assets/\u4ee3\u7801\u5757\u91cc\u7684\u56fe\u7247.png]]') >= 0;
  })()`);
  results.push({
    label: "D. 代码块里的 ![[...]] 保持原样",
    codeKept,
    pass: codeKept === true,
  });

  // C. 光标进入该行 → 显示源码
  await js(`(() => {
    const v = window.__EDITOR_HANDLE__.view;
    const doc = v.state.doc;
    for (let i = 1; i <= doc.lines; i++) {
      const t = doc.line(i).text;
      if (t.indexOf('![[') >= 0 && t.indexOf('\u5c01\u9762') >= 0) {
        v.dispatch({ selection: { anchor: doc.line(i).from + 2 } });
        return;
      }
    }
  })()`);
  await sleep(700);

  const sourceMode = await js(`(() => {
    const lines = Array.from(document.querySelectorAll('.cm-line'));
    return {
      hasSource: lines.some(e => e.textContent.indexOf('![[') >= 0),
      imgCount: document.querySelectorAll('.cm-embed-img').length,
    };
  })()`);

  results.push({
    label: "C. 光标进入后显示 ![[ 源码",
    ...sourceMode,
    pass: sourceMode.hasSource === true,
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

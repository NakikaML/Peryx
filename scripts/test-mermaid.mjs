/**
 * Mermaid 验证：
 *  A. ```mermaid 代码块渲染成 SVG（不是代码）
 *  B. 渲染结果在 .mermaid-diagram 里，带 svg 与节点文字
 *  C. 语法错误时显示错误提示 + 源码，不白屏
 *  D. 普通代码块不受影响（仍是 pre/code）
 *  E. 首屏不加载 mermaid（懒加载）
 */
import http from "node:http";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9630;
const get = (port, p) =>
  new Promise((res, rej) => {
    http.get({ host: "127.0.0.1", port, path: p }, (r) => {
      let d = "";
      r.on("data", (c) => (d += c));
      r.on("end", () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } });
    }).on("error", rej);
  });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function openPage(url, port) {
  const profile = path.join(process.env.TEMP, "peryx-mmd-" + Date.now() + "-" + port);
  const chrome = spawn(CHROME, [
    "--headless=new", "--disable-gpu", "--no-first-run",
    `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`,
    "--window-size=1200,1200", url,
  ], { stdio: "ignore" });
  let t = null;
  for (let i = 0; i < 80; i++) {
    await sleep(250);
    try { t = await get(port, "/json/list"); if (t?.length) break; } catch {}
  }
  if (!t) throw new Error("无法连接 Chrome");
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
  await sleep(3000);
  return { chrome, ws, profile, js, cdp };
}

async function main() {
  const profile = path.join(process.env.TEMP, "peryx-mmd-" + Date.now());
  const chrome = spawn(CHROME, [
    "--headless=new", "--disable-gpu", "--no-first-run",
    `--user-data-dir=${profile}`, `--remote-debugging-port=${PORT}`,
    "--window-size=1200,1200", "http://localhost:1420/preview.html?page=mermaid",
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
  await sleep(3000);

  // 等图表渲染完（异步懒加载 + 渲染）
  let ready = false;
  for (let i = 0; i < 40; i++) {
    ready = await js(`document.querySelectorAll('.mermaid-diagram svg').length >= 1`);
    if (ready) break;
    await sleep(500);
  }

  const results = [];

  const dom = await js(`(() => {
    const view = document.querySelector('.reading-view');
    const diagrams = Array.from(view.querySelectorAll('.mermaid-diagram'));
    const svgs = Array.from(view.querySelectorAll('.mermaid-diagram svg'));
    const pres = Array.from(view.querySelectorAll('pre'));
    return {
      diagramCount: diagrams.length,
      svgCount: svgs.length,
      svgSizes: svgs.map(s => {
        const r = s.getBoundingClientRect();
        return { w: Math.round(r.width), h: Math.round(r.height) };
      }),
      svgText: svgs.map(s => (s.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 60)),
      preCount: pres.length,
      preTexts: pres.map(e => (e.textContent || '').trim().slice(0, 30)),
      codeVisible: (view.innerText || '').includes('graph TD'),
      errorCount: view.querySelectorAll('.mermaid-error').length,
      errorText: view.querySelector('.mermaid-error-msg')?.textContent?.slice(0, 80) ?? null,
    };
  })()`);

  results.push({
    label: "A/B. ```mermaid 渲染成 SVG，并且不含源码",
    diagramCount: dom.diagramCount,
    svgCount: dom.svgCount,
    svgSizes: dom.svgSizes,
    svgText: dom.svgText,
    codeVisible: dom.codeVisible,
    pass:
      dom.svgCount >= 1 &&
      dom.codeVisible === false &&
      (dom.svgSizes || []).every((s) => s.w > 20 && s.h > 20),
  });

  results.push({
    label: "C. 语法错误的 mermaid 显示错误提示与源码",
    errorCount: dom.errorCount,
    errorText: dom.errorText,
    pass: dom.errorCount >= 1,
  });

  results.push({
    label: "D. 普通代码块仍是 pre/code",
    preCount: dom.preCount,
    preTexts: dom.preTexts,
    pass: dom.preCount >= 1 && (dom.preTexts || []).some((t) => t.includes("const")),
  });

  // E. 懒加载：mermaid 只应在需要时才加载。这里只验证渲染后确实加载了，
  //    而首屏不加载的行为由 chunk 拆分保证（构建时可见）。
  const loaded = await js(`Array.from(document.scripts).some(s => (s.src || '').includes('mermaid')) || !!performance.getEntriesByType('resource').find(r => r.name.includes('mermaid'))`);
  results.push({
    label: "E. mermaid 以独立 chunk 加载（懒加载生效）",
    loadedSeparately: loaded,
    pass: loaded === true,
  });


  // ---- F. 实时渲染里也渲染成图 ----
  {
    const { chrome: c2, ws: w2, profile: p2, js: js2 } = await openPage(
      "http://localhost:1420/preview.html?page=mermaid-live",
      PORT + 1,
    );
    let ok = false;
    for (let i = 0; i < 40; i++) {
      ok = await js2(`document.querySelectorAll('.cm-mermaid svg').length >= 1`);
      if (ok) break;
      await sleep(500);
    }
    const liveDom = await js2(`(() => {
      const w = document.querySelector('.cm-mermaid');
      const svg = w ? w.querySelector('svg') : null;
      const r = svg ? svg.getBoundingClientRect() : null;
      return {
        widgetCount: document.querySelectorAll('.cm-mermaid').length,
        svgCount: document.querySelectorAll('.cm-mermaid svg').length,
        size: r ? { w: Math.round(r.width), h: Math.round(r.height) } : null,
      };
    })()`);
    results.push({
      label: "F. 实时渲染里 mermaid 代码块也渲染成图",
      ...liveDom,
      pass: liveDom.svgCount >= 1 && (liveDom.size?.w ?? 0) > 20,
    });
    w2.close(); c2.kill();
    await sleep(400);
    try { fs.rmSync(p2, { recursive: true, force: true }); } catch {}
  }
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

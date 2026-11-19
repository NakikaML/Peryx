/**
 * 验证「能不能点进被装饰的区间内部」：
 *  A. 点击加粗文字内部 → 光标落在加粗范围内
 *  B. 点击 ![[图片]] → 先展开源码，再点内部能进到 `![[` 之后
 *  C. 点击双链源码内部 → 光标能落在链接范围内
 */
import http from "node:http";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9580;
const PAGE = "http://localhost:1420/preview.html?page=caret";

function get(port, p) {
  return new Promise((res, rej) => {
    http.get({ host: "127.0.0.1", port, path: p }, (r) => {
      let d = "";
      r.on("data", (c) => (d += c));
      r.on("end", () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } });
    }).on("error", rej);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const profile = path.join(process.env.TEMP, "peryx-caret-" + Date.now());
  const chrome = spawn(CHROME, [
    "--headless=new", "--disable-gpu", "--no-first-run",
    `--user-data-dir=${profile}`, `--remote-debugging-port=${PORT}`,
    "--window-size=1100,900", PAGE,
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

  for (let i = 0; i < 80; i++) {
    if (await js("!!(window.__EDITOR_HANDLE__ && window.__EDITOR_HANDLE__.view)")) break;
    await sleep(250);
  }
  await sleep(1800);

  // 光标先移到最后，让所有行处于渲染态
  await js(`(() => {
    const v = window.__EDITOR_HANDLE__.view;
    v.dispatch({ selection: { anchor: v.state.doc.length } });
  })()`);
  await sleep(700);

  const results = [];

  /** 在某个 CSS 选择器元素的中心点做真实鼠标点击 */
  async function clickSelector(sel, xRatio = 0.5) {
    const box = await js(`(() => {
      const el = document.querySelector(${JSON.stringify(sel)});
      if (!el) return null;
      el.scrollIntoView({ block: 'center' });
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.left + r.width * ${xRatio}), y: Math.round(r.top + r.height / 2) };
    })()`);
    if (!box) return null;
    await cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: box.x, y: box.y });
    await cdp("Input.dispatchMouseEvent", { type: "mousePressed", x: box.x, y: box.y, button: "left", buttons: 1, clickCount: 1 });
    await cdp("Input.dispatchMouseEvent", { type: "mouseReleased", x: box.x, y: box.y, button: "left", buttons: 0, clickCount: 1 });
    await sleep(500);
    return js(`(() => {
      const v = window.__EDITOR_HANDLE__.view;
      const head = v.state.selection.main.head;
      const doc = v.state.doc.toString();
      const line = v.state.doc.lineAt(head);
      return { head, lineNo: line.number, lineText: line.text, col: head - line.from };
    })()`);
  }

  // ---- A. 加粗文字内部 ----
  const bold = await clickSelector(".cm-strong");
  results.push({
    label: "A. 点击加粗文字内部，光标能落在加粗范围内",
    ...bold,
    pass: !!bold && bold.lineText.includes("**") && bold.col > 1,
  });

  // ---- B. 图片嵌入 ----
  // 第一次点击图片 widget（应展开为源码）
  const embed1 = await clickSelector(".cm-embed");
  const afterFirst = await js(`(() => {
    const v = window.__EDITOR_HANDLE__.view;
    const lines = Array.from(document.querySelectorAll('.cm-line'));
    return {
      sourceShown: lines.some(e => e.textContent.indexOf('![[') >= 0),
      head: v.state.selection.main.head,
    };
  })()`);

  // 展开后，点击源码内部（在 ![[] 之后）
  const insidePos = await js(`(() => {
    const v = window.__EDITOR_HANDLE__.view;
    const doc = v.state.doc;
    for (let i = 1; i <= doc.lines; i++) {
      const t = doc.line(i).text;
      const idx = t.indexOf('![[图片.png]]');
      if (idx >= 0) {
        const lineNo = i;
        // 用 DOM Range 定位到 ![[] 之后的第一个字符
        const els = Array.from(document.querySelectorAll('.cm-line'));
        const el = els.find(e => (e.textContent || '').indexOf('![[图片.png]]') >= 0);
        if (!el) return null;
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        let used = 0;
        let node = walker.nextNode();
        while (node) {
          const len = node.textContent.length;
          if (used + len > idx + 3) {
            const range = document.createRange();
            range.setStart(node, Math.min(idx + 3 - used, len - 1));
            range.setEnd(node, Math.min(idx + 4 - used, len));
            const r = range.getBoundingClientRect();
            return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), lineNo };
          }
          used += len;
          node = walker.nextNode();
        }
        return null;
      }
    }
    return null;
  })()`);

  let inside = null;
  if (insidePos) {
    await cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: insidePos.x, y: insidePos.y });
    await cdp("Input.dispatchMouseEvent", { type: "mousePressed", x: insidePos.x, y: insidePos.y, button: "left", buttons: 1, clickCount: 1 });
    await cdp("Input.dispatchMouseEvent", { type: "mouseReleased", x: insidePos.x, y: insidePos.y, button: "left", buttons: 0, clickCount: 1 });
    await sleep(500);
    inside = await js(`(() => {
      const v = window.__EDITOR_HANDLE__.view;
      const head = v.state.selection.main.head;
      const doc = v.state.doc.toString();
      // 找到 ![[ 的起点，判断光标是否落在链接内部
      const start = doc.indexOf('![[');
      const end = doc.indexOf(']]', start) + 2;
      const line = v.state.doc.lineAt(head);
      return {
        head,
        inside: head > start && head < end,
        lineText: line.text,
        col: head - line.from,
        start, end,
      };
    })()`);
  }

  results.push({
    label: "B. 点击图片后展开源码，且能点进源码内部编辑",
    afterFirst,
    inside,
    pass: !!inside && inside.inside === true,
  });

  // ---- C. 双链源码内部 ----
  const wikiInside = await js(`(() => {
    // 先点到双链所在行让它展开
    const v = window.__EDITOR_HANDLE__.view;
    const doc = v.state.doc;
    for (let i = 1; i <= doc.lines; i++) {
      if (doc.line(i).text.indexOf('[[双链目标]]') >= 0) {
        v.dispatch({ selection: { anchor: doc.line(i).from } });
        return true;
      }
    }
    return false;
  })()`);
  void wikiInside;
  await sleep(500);

  const wikiClick = await js(`(() => {
    const v = window.__EDITOR_HANDLE__.view;
    const doc = v.state.doc.toString();
    const start = doc.indexOf('[[双链目标]]');
    const end = start + '[[双链目标]]'.length;
    const els = Array.from(document.querySelectorAll('.cm-line'));
    const el = els.find(e => (e.textContent || '').indexOf('[[双链目标]]') >= 0);
    if (!el) return null;
    const lineStart = v.state.doc.lineAt(start).from;
    const col = start - lineStart;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let used = 0;
    let node = walker.nextNode();
    while (node) {
      const len = node.textContent.length;
      if (used + len > col + 3) {
        const range = document.createRange();
        range.setStart(node, Math.min(col + 3 - used, len - 1));
        range.setEnd(node, Math.min(col + 4 - used, len));
        const r = range.getBoundingClientRect();
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), start, end };
      }
      used += len;
      node = walker.nextNode();
    }
    return null;
  })()`);

  let wikiResult = null;
  if (wikiClick) {
    await cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: wikiClick.x, y: wikiClick.y });
    await cdp("Input.dispatchMouseEvent", { type: "mousePressed", x: wikiClick.x, y: wikiClick.y, button: "left", buttons: 1, clickCount: 1 });
    await cdp("Input.dispatchMouseEvent", { type: "mouseReleased", x: wikiClick.x, y: wikiClick.y, button: "left", buttons: 0, clickCount: 1 });
    await sleep(500);
    wikiResult = await js(`(() => {
      const v = window.__EDITOR_HANDLE__.view;
      const head = v.state.selection.main.head;
      const doc = v.state.doc.toString();
      const start = doc.indexOf('[[双链目标]]');
      const end = start + '[[双链目标]]'.length;
      return { head, inside: head > start && head < end, start, end };
    })()`);
  }

  results.push({
    label: "C. 点击双链源码内部能编辑",
    wikiResult,
    pass: !!wikiResult && wikiResult.inside === true,
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

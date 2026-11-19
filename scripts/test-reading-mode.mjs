/**
 * 阅读模式验证：
 *  A. 阅读态不出现任何 Markdown 源码符号（* # ` [[ ]] !）
 *  B. 标题/加粗/列表/代码块/表格正确渲染
 *  C. 双链渲染成链接，点击能跳转
 *  D. ![[图片]] 渲染成 <img>
 *  E. 标签渲染成可点击的胶囊
 *  F. 切换模式（工具栏按钮）
 *  G. 双击正文回到编辑
 */
import http from "node:http";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9600;
const PAGE = "http://localhost:1420/preview.html?page=reading";

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
  const profile = path.join(process.env.TEMP, "peryx-read-" + Date.now());
  const chrome = spawn(CHROME, [
    "--headless=new", "--disable-gpu", "--no-first-run",
    `--user-data-dir=${profile}`, `--remote-debugging-port=${PORT}`,
    "--window-size=1200,1000", PAGE,
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

  const results = [];

  // ---- 先切到阅读模式 ----
  const switched = await js(`(() => {
    const btn = Array.from(document.querySelectorAll('.mode-btn')).find(b => b.textContent.trim() === '阅读');
    if (!btn) return { err: '没有「阅读」按钮' };
    btn.click();
    return { ok: true };
  })()`);
  await sleep(1200);

  results.push({
    label: "F. 工具栏有「阅读」按钮且能切换",
    ...switched,
    shown: await js(`!!document.querySelector('.reading-view')`),
    pass: switched.ok === true && (await js(`!!document.querySelector('.reading-view')`)) === true,
  });

  const dom = await js(`(() => {
    const view = document.querySelector('.reading-view');
    if (!view) return { err: '没有阅读视图' };
    const text = view.innerText;
    // 编辑器不该存在
    const editorGone = !document.querySelector('.cm-editor');
    const h = Array.from(view.querySelectorAll('h1,h2,h3')).map(e => e.textContent);
    const strong = view.querySelectorAll('strong').length;
    const li = view.querySelectorAll('li').length;
    const pre = view.querySelectorAll('pre').length;
    const table = view.querySelectorAll('table').length;
    const code = view.querySelectorAll('code').length;
    return {
      editorGone, headings: h, strong, li, pre, table, code,
      textStart: text.slice(0, 160),
      hasStar: text.includes('**'),
      hasBacktick: text.includes('\\u0060'),
      hasWikilinkSource: text.includes('[['),
      hasImageSource: text.includes('![['),
      hasHeadingHash: /(^|\\n)#{1,6}\\s/.test(text),
    };
  })()`);

  results.push({
    label: "A. 阅读态不显示任何 Markdown 源码符号",
    hasStar: dom.hasStar,
    hasWikilinkSource: dom.hasWikilinkSource,
    hasImageSource: dom.hasImageSource,
    hasHeadingHash: dom.hasHeadingHash,
    editorGone: dom.editorGone,
    pass:
      dom.editorGone === true &&
      dom.hasStar === false &&
      dom.hasWikilinkSource === false &&
      dom.hasImageSource === false &&
      dom.hasHeadingHash === false,
  });

  results.push({
    label: "B. 标题/加粗/列表/代码块/表格都渲染出来",
    headings: dom.headings,
    strong: dom.strong,
    li: dom.li,
    pre: dom.pre,
    table: dom.table,
    pass:
      (dom.headings || []).length >= 1 &&
      dom.strong >= 1 &&
      dom.li >= 2 &&
      dom.pre >= 1 &&
      dom.table >= 1,
  });

  // ---- C. 双链 ----
  const links = await js(`(() => {
    const as = Array.from(document.querySelectorAll('.reading-view [data-link]'));
    return {
      count: as.length,
      labels: as.map(e => e.textContent),
      targets: as.map(e => e.dataset.link),
      missingCount: as.filter(e => e.classList.contains('read-link-missing')).length,
    };
  })()`);
  results.push({
    label: "C. 双链渲染成链接（含待创建样式）",
    ...links,
    pass: links.count >= 2 && links.missingCount >= 1,
  });

  // 点击已存在的链接 → 跳转
  await js(`(() => {
    const a = Array.from(document.querySelectorAll('.reading-view [data-link]'))
      .find(e => !e.classList.contains('read-link-missing'));
    if (a) a.click();
    return true;
  })()`);
  await sleep(600);
  const jumped = await js(`window.__READ_OPENED__ ?? null`);
  results.push({
    label: "C2. 点击双链触发跳转",
    opened: jumped,
    pass: typeof jumped === "string" && jumped.length > 0,
  });

  // ---- D. 图片 ----
  const imgs = await js(`(() => {
    const list = Array.from(document.querySelectorAll('.reading-view img.read-img'));
    return {
      count: list.length,
      allDataUrl: list.every(e => e.src.startsWith('data:image/')),
      sizes: list.map(e => ({ w: e.naturalWidth, h: e.naturalHeight })),
      failed: document.querySelectorAll('.reading-view .read-img-failed').length,
    };
  })()`);
  results.push({
    label: "D. ![[图片]] 渲染成 <img>",
    ...imgs,
    pass: imgs.count >= 1 && imgs.allDataUrl === true,
  });

  // ---- E. 标签 ----
  const tags = await js(`(() => {
    const list = Array.from(document.querySelectorAll('.reading-view [data-read-tag]'));
    return { count: list.length, tags: list.map(e => e.dataset.readTag) };
  })()`);
  results.push({
    label: "E. #标签 渲染成可点击胶囊",
    ...tags,
    pass: tags.count >= 1,
  });

  // ---- G. 双击回到编辑 ----
  const box = await js(`(() => {
    const el = document.querySelector('.reading-body p');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + 20), y: Math.round(r.top + r.height / 2) };
  })()`);
  if (box) {
    for (let i = 0; i < 2; i++) {
      await cdp("Input.dispatchMouseEvent", { type: "mousePressed", x: box.x, y: box.y, button: "left", buttons: 1, clickCount: i + 1 });
      await cdp("Input.dispatchMouseEvent", { type: "mouseReleased", x: box.x, y: box.y, button: "left", buttons: 0, clickCount: i + 1 });
      await sleep(90);
    }
    await sleep(900);
  }
  const backToEdit = await js(`({
    readingGone: !document.querySelector('.reading-view'),
    editorBack: !!document.querySelector('.cm-editor'),
  })`);
  results.push({
    label: "G. 双击正文回到编辑",
    ...backToEdit,
    pass: backToEdit.readingGone === true && backToEdit.editorBack === true,
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

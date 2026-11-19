/**
 * 验证：
 *  A. 加粗里的行内公式能正常渲染（不再显示 $...$ 源码）
 *  B. 加粗仍生效（** 隐藏、文字加粗）
 *  C. 块级公式阅读态不再显示淡色源码，只留渲染结果
 *  D. 点击块级公式能切回编辑态
 *  E. 多行块级公式同样只显示渲染结果
 */
import http from "node:http";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9590;
const PAGE = "http://localhost:1420/preview.html?page=mathbold";

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
  const profile = path.join(process.env.TEMP, "peryx-math-" + Date.now());
  const chrome = spawn(CHROME, [
    "--headless=new", "--disable-gpu", "--no-first-run",
    `--user-data-dir=${profile}`, `--remote-debugging-port=${PORT}`,
    "--window-size=1200,900", PAGE,
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
  await sleep(2200);

  // 光标移到最后，所有行处于「阅读态」
  await js(`(() => {
    const v = window.__EDITOR_HANDLE__.view;
    v.dispatch({ selection: { anchor: v.state.doc.length } });
  })()`);
  await sleep(900);

  const results = [];

  // ---- A/B. 加粗里的行内公式 ----
  const boldMath = await js(`(() => {
    const lines = Array.from(document.querySelectorAll('.cm-line'));
    const line = lines.find(e => (e.textContent || '').includes('突发长度'));
    if (!line) return { err: '没找到目标行' };
    const text = line.textContent || '';
    const inlineMath = line.querySelectorAll('.cm-inline-math');
    const strong = line.querySelectorAll('.cm-strong');
    // ** 标记用 .cm-mark-hidden 压成 0 宽，文字还在 DOM 里但不可见 —— 要查计算样式
    const hiddenMarks = Array.from(line.querySelectorAll('.cm-mark-hidden'));
    const starMarks = hiddenMarks.filter(e => (e.textContent || '').includes('**'));
    const invisible = starMarks.length > 0 && starMarks.every(e => {
      const cs = getComputedStyle(e);
      return parseFloat(cs.fontSize) === 0 || parseFloat(cs.opacity) === 0;
    });
    return {
      lineText: text,
      hasDollar: text.includes('$'),
      mathWidgets: inlineMath.length,
      mathText: Array.from(inlineMath).map(e => e.textContent.trim()),
      strongCount: strong.length,
      strongText: Array.from(strong).map(e => e.textContent),
      hiddenStarMarks: starMarks.length,
      starsInvisible: invisible,
      strongWeight: strong.length ? getComputedStyle(strong[0]).fontWeight : null,
    };
  })()`);

  results.push({
    label: "A. 加粗里的行内公式渲染成 KaTeX（不再显示 $ 源码）",
    ...boldMath,
    pass: boldMath.hasDollar === false && boldMath.mathWidgets >= 1,
  });

  results.push({
    label: "B. 同一行的加粗同时生效（** 不可见、内容加粗）",
    hiddenStarMarks: boldMath.hiddenStarMarks,
    starsInvisible: boldMath.starsInvisible,
    strongCount: boldMath.strongCount,
    strongWeight: boldMath.strongWeight,
    pass:
      boldMath.hiddenStarMarks >= 2 &&
      boldMath.starsInvisible === true &&
      boldMath.strongCount >= 1 &&
      (boldMath.strongWeight === "700" || parseInt(boldMath.strongWeight || "0", 10) >= 600),
  });

  // ---- C. 块级公式阅读态 ----
  const blockMath = await js(`(() => {
    const previews = Array.from(document.querySelectorAll('.cm-formula-preview'));
    const lines = Array.from(document.querySelectorAll('.cm-line'));
    const dollarLines = lines.filter(e => (e.textContent || '').includes('$$'));
    return {
      previewCount: previews.length,
      // 阅读态下不该再看到 $$ 源码
      dollarVisible: dollarLines.map(e => e.textContent),
      // 渲染容器里有 KaTeX
      hasKatex: previews.some(e => !!e.querySelector('.katex')),
      previewTexts: previews.map(e => (e.textContent || '').slice(0, 20)),
    };
  })()`);

  results.push({
    label: "C. 块级公式阅读态只显示渲染结果，不再有淡色源码",
    ...blockMath,
    pass: blockMath.dollarVisible.length === 0 && blockMath.hasKatex,
  });

  // ---- E. 多行块级公式 ----
  const multiLine = await js(`(() => {
    const previews = Array.from(document.querySelectorAll('.cm-block-math'));
    return { blockMathCount: previews.length };
  })()`);
  results.push({
    label: "E. 多行块级公式也只显示渲染结果",
    ...multiLine,
    pass: multiLine.blockMathCount >= 2,
  });

  // ---- D. 点击块公式 → 切回编辑态 ----
  const box = await js(`(() => {
    const el = document.querySelector('.cm-block-math');
    if (!el) return null;
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  })()`);
  if (box) {
    await cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: box.x, y: box.y });
    await cdp("Input.dispatchMouseEvent", { type: "mousePressed", x: box.x, y: box.y, button: "left", buttons: 1, clickCount: 1 });
    await cdp("Input.dispatchMouseEvent", { type: "mouseReleased", x: box.x, y: box.y, button: "left", buttons: 0, clickCount: 1 });
    await sleep(800);
  }
  const afterClick = await js(`(() => {
    const lines = Array.from(document.querySelectorAll('.cm-line'));
    const dollar = lines.filter(e => (e.textContent || '').includes('$$'));
    return { dollarCount: dollar.length, texts: dollar.map(e => e.textContent.slice(0, 24)) };
  })()`);

  results.push({
    label: "D. 点击块级公式切回编辑态（显示 $$ 源码）",
    ...afterClick,
    pass: afterClick.dollarCount >= 1,
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

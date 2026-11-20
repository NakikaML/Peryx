/**
 * frontmatter（YAML）不该在正文里重复显示。
 *
 *  A. 实时渲染：正文里看不到 frontmatter 原文（已折叠）
 *  B. 实时渲染：光标移进 frontmatter 时临时展开（保留手改入口）
 *  C. 源码模式：完整显示 frontmatter（本来就是看原文）
 *  D. 阅读模式：正文不含 frontmatter
 *  E. 属性面板仍在（折叠只是正文层面的事）
 *  F. PDF 导出内容不含 frontmatter
 */
import http from "node:http";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9800;
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
  const profile = path.join(process.env.TEMP, "peryx-fm-" + Date.now());
  const chrome = spawn(CHROME, [
    "--headless=new", "--disable-gpu", "--no-first-run",
    `--user-data-dir=${profile}`, `--remote-debugging-port=${PORT}`,
    "--window-size=1400,950", "http://localhost:1420/preview.html?page=split",
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
  await sleep(3200);

  const results = [];

  await js(`(() => {
    const i = Array.from(document.querySelectorAll('.tree-item'))
      .find(e => (e.textContent || '').includes('属性笔记'));
    if (i) i.click();
    return true;
  })()`);
  await sleep(1500);

  /** 当前编辑器里可见的文本（排除 display:none 的折叠块） */
  const visibleText = () =>
    js(`(() => {
      const content = document.querySelector('.cm-content');
      if (!content) return null;
      // innerText 会跳过 display:none 的内容
      return content.innerText;
    })()`);

  // A. 实时渲染里看不到 frontmatter
  const live = await visibleText();
  results.push({
    label: "A. 实时渲染：正文里看不到 frontmatter 原文",
    hasTitleKey: String(live).includes("title:"),
    hasAliasesKey: String(live).includes("aliases:"),
    hasHeading: String(live).includes("属性笔记"),
    pass:
      !String(live).includes("title:") &&
      !String(live).includes("aliases:") &&
      String(live).includes("属性笔记"),
  });

  // E. 属性面板还在（默认折叠，先展开）
  await js(`(() => { const b = document.querySelector('.props-toggle'); if (b) b.click(); return true; })()`);
  await sleep(500);
  const panel = await js(`(() => ({
    props: document.querySelectorAll('.prop-row').length,
    keys: Array.from(document.querySelectorAll('.prop-row')).map(r => r.dataset.propKey),
  }))()`);
  results.push({
    label: "E. 属性面板仍在（折叠只作用于正文）",
    ...panel,
    pass: panel.props >= 4 && panel.keys.includes("aliases"),
  });

  // B. 光标移进 frontmatter → 展开
  await js(`(() => {
    const content = document.querySelector('.cm-content');
    const line = content?.querySelector('.cm-line');
    if (!line) return false;
    const range = document.createRange();
    range.setStart(line.firstChild ?? line, 0);
    range.collapse(true);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    content.focus();
    return true;
  })()`);
  // 上面只是浏览器选区，CodeMirror 需要真实键盘：用 Ctrl+Home 把光标送到文首
  await cdp("Input.dispatchKeyEvent", { type: "keyDown", key: "Home", code: "Home", windowsVirtualKeyCode: 36, modifiers: 2 });
  await cdp("Input.dispatchKeyEvent", { type: "keyUp", key: "Home", code: "Home", windowsVirtualKeyCode: 36, modifiers: 2 });
  await sleep(900);
  const expanded = await js(`(() => {
    const content = document.querySelector('.cm-content');
    return {
      text: content ? content.innerText.slice(0, 40) : null,
      hidden: document.querySelectorAll('.cm-frontmatter-hidden').length,
    };
  })()`);
  results.push({
    label: "B. 光标进入 frontmatter → 临时展开可见",
    text: expanded.text,
    hiddenBlocks: expanded.hidden,
    pass: String(expanded.text).includes("title") && expanded.hidden === 0,
  });

  // C. 源码模式
  await js(`(() => {
    const b = document.querySelector('.note-head [data-mode="source"]');
    if (b) b.click();
    return true;
  })()`);
  await sleep(1200);
  const src = await js(`(() => {
    const c = document.querySelector('.cm-content');
    return c ? c.innerText.slice(0, 60) : null;
  })()`);
  results.push({
    label: "C. 源码模式：完整显示 frontmatter",
    text: src,
    pass: String(src).includes("title:") && String(src).includes("---"),
  });

  // C2. 源码模式下没有属性面板（只在正文里看 YAML 源码）
  const srcPanel = await js(`document.querySelectorAll('.props').length`);
  results.push({
    label: "C2. 源码模式：不显示属性面板",
    panelCount: srcPanel,
    pass: srcPanel === 0,
  });

  // D. 阅读模式
  await js(`(() => {
    const b = document.querySelector('.note-head [data-mode="read"]');
    if (b) b.click();
    return true;
  })()`);
  await sleep(1500);
  const reading = await js(`(() => {
    const v = document.querySelector('.reading-body');
    if (!v) return null;
    return { text: v.innerText.slice(0, 120) };
  })()`);
  const readPanel = await js(`document.querySelectorAll('.props').length`);
  results.push({
    label: "D2. 阅读模式：不显示属性面板",
    panelCount: readPanel,
    pass: readPanel === 0,
  });

  results.push({
    label: "D. 阅读模式：正文不含 frontmatter",
    text: reading?.text,
    pass:
      reading !== null &&
      !String(reading.text).includes("title:") &&
      !String(reading.text).includes("aliases:") &&
      String(reading.text).includes("属性笔记"),
  });

  // F. PDF 导出
  const html = String(await js(
    "(async () => {" +
    "  const mod = await import('/src/lib/exportPdf.ts');" +
    "  return await mod.buildPrintableHtml({" +
    "    title: '属性笔记', docPath: '属性笔记.md'," +
    "    markdown: '---\\ntitle: 属性笔记\\naliases:\\n  - 别名\\n---\\n\\n# 正文标题\\n\\n正文内容\\n'" +
    "  });" +
    "})()",
  ));
  results.push({
    label: "F. PDF 导出不含 frontmatter",
    hasTitleKey: html.includes("title:"),
    hasBody: html.includes("正文内容"),
    pass: !html.includes("title:") && html.includes("正文内容"),
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

/**
 * v0.3 第 6 项：导出 PDF。
 *
 * 实现是「生成打印用 HTML → 系统打印对话框另存为 PDF」，
 * 所以测试直接检查**生成的 HTML**（不真弹打印框）。
 *
 *  A. 笔记头部有「导出 PDF」按钮
 *  B. 生成的 HTML 含 @page A4 与打印样式
 *  C. 标题、正文、代码块、表格都在
 *  D. 双链转成纯文字（没有占位符残留）
 *  E. 图片内联为 data URL（或明确的占位提示）
 *  F. Mermaid 变成内联 SVG
 *  G. 公式保留 KaTeX 结构
 */
import http from "node:http";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9780;
const get = (port, p) =>
  new Promise((res, rej) => {
    http.get({ host: "127.0.0.1", port, path: p }, (r) => {
      let d = "";
      r.on("data", (c) => (d += c));
      r.on("end", () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } });
    }).on("error", rej);
  });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 测试用的富文本（普通字符串，避免和模板字符串的反引号打架） */
const MD_LINES = [
  "# 导出测试",
  "",
  "正文一段，含 **加粗** 与行内公式 $a^2+b^2=c^2$。",
  "",
  "链接：[[笔记B]] 与 [[笔记B|自定义文字]]。",
  "",
  "> [!note] 标注块",
  "> 这是 callout。",
  "",
  "| 列一 | 列二 |",
  "| --- | --- |",
  "| 甲 | 乙 |",
  "",
  "```js",
  "const a = 1;",
  "```",
  "",
  "$$",
  "\\eta = \\frac{pq}{(p+1)(q+1)}",
  "$$",
  "",
  "```mermaid",
  "graph LR",
  "  A --> B",
  "```",
  "",
  "图片：![[测试图.png]]",
  "",
  "脚注[^1]",
  "",
  "[^1]: 脚注内容",
  "",
];

async function main() {
  const profile = path.join(process.env.TEMP, "peryx-pdf-" + Date.now());
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

  const openNote = async (name) => {
    await js(`(() => {
      const i = Array.from(document.querySelectorAll('.tree-item'))
        .find(e => (e.textContent || '').includes('${name}'));
      if (i) i.click();
      return true;
    })()`);
    await sleep(1200);
  };

  await openNote("笔记A");

  // A. 按钮存在
  const btn = await js(`(() => {
    const b = document.querySelector('[data-action="export-pdf"]');
    return b ? { exists: true, title: b.title } : { exists: false };
  })()`);
  results.push({
    label: "A. 笔记头部有「导出 PDF」按钮",
    ...btn,
    pass: btn.exists === true,
  });

  // 调 buildPrintableHtml 生成 HTML
  const expr =
    "(async () => {" +
    "  const mod = await import('/src/lib/exportPdf.ts');" +
    "  const md = " + JSON.stringify(MD_LINES) + ".join('\\n');" +
    "  return await mod.buildPrintableHtml({" +
    "    title: '导出测试', docPath: '笔记A.md', markdown: md" +
    "  });" +
    "})()";
  const html = String(await js(expr));

  const has = (s) => html.includes(s);

  // B. 打印样式
  results.push({
    label: "B. 含 @page A4 与打印样式",
    pass: has("@page") && has("A4") && has("@media print"),
  });

  // C. 基本排版
  results.push({
    label: "C. 标题 / 正文 / 代码块 / 表格都在",
    pass: has("导出测试") && has("<strong>") && has("<pre") && has("<table"),
  });

  // D. 双链转纯文字
  const placeholderLeft = html.includes("\uE000") || html.includes("[[");
  results.push({
    label: "D. 双链转成纯文字（无占位符残留）",
    placeholderLeft,
    hasCustomText: has("自定义文字"),
    pass: !placeholderLeft && has("自定义文字") && has("doc-link"),
  });

  // E. 图片内联
  results.push({
    label: "E. 图片内联为 data URL（或明确占位提示）",
    inline: has("data:image"),
    missing: has("doc-img-missing"),
    pass: has("data:image") || has("doc-img-missing"),
  });

  // F. Mermaid 变 SVG
  results.push({
    label: "F. Mermaid 渲染成内联 SVG",
    svg: has("<svg"),
    // 注意不能只搜 "mermaid-block"：打印样式的 CSS 里也有这个词
    rawBlockLeft: has('<div class="mermaid-block"'),
    pass: has("<svg") && !has('<div class="mermaid-block"'),
  });

  // G. 公式
  results.push({
    label: "G. 公式保留 KaTeX 结构",
    pass: has("katex") || has("math"),
  });

  console.log(JSON.stringify(results, null, 2));
  const passed = results.filter((r) => r.pass).length;
  console.log(`\n=== 汇总：${passed}/${results.length} 通过 ===`);
  results.filter((r) => !r.pass).forEach((r) => console.log(`  FAIL ${r.label}`));
  console.log("HTML 长度:", html.length);

  ws.close(); chrome.kill();
  await sleep(500);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
  process.exit(passed === results.length ? 0 : 2);
}
main().catch((e) => { console.error(e.message); process.exit(1); });

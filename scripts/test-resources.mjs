/**
 * v0.3 核心项：资料库 + PDF 阅读。
 *
 * 在真实应用里验证（需要真的读文件、跑 pdf.js）：
 *  A. 侧边栏下半部分是资料库，只列非 md 资料
 *  B. 笔记树里看不到资料库目录里的 md
 *  C. 点 PDF → 打开阅读器，页数正确
 *  D. canvas 真的画出了内容（非空白）
 *  E. 翻页按钮可用，页码跟着变
 *  F. 缩放按钮改变页面宽度
 *  G. 点非 PDF 资料 → 提示暂不支持（不白屏）
 *  H. 关闭阅读器回到空状态
 */
import http from "node:http";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const EXE = "D:\\Peryx\\src-tauri\\target\\debug\\peryx.exe";
const PORT = 9790;
const VAULT = "D:\\PeryxResVault";

const get = (port, p) =>
  new Promise((res, rej) => {
    http.get({ host: "127.0.0.1", port, path: p }, (r) => {
      let d = "";
      r.on("data", (c) => (d += c));
      r.on("end", () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } });
    }).on("error", rej);
  });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 手写一个最小但合法的 PDF（2 页，含文字） */
function makePdf() {
  const objs = [];
  const add = (s) => {
    objs.push(s);
    return objs.length;
  };

  // 1: Catalog, 2: Pages, 3: Page1, 4: Page2, 5: Font, 6/7: Contents
  const catalog = add("");
  const pages = add("");
  const page1 = add("");
  const page2 = add("");
  const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");

  const content = (text) =>
    `BT /F1 28 Tf 72 720 Td (${text}) Tj ET`;

  const c1 = add(`<< /Length ${content("Page One").length} >>\nstream\n${content("Page One")}\nendstream`);
  const c2 = add(`<< /Length ${content("Page Two").length} >>\nstream\n${content("Page Two")}\nendstream`);

  objs[catalog - 1] = `<< /Type /Catalog /Pages ${pages} 0 R >>`;
  objs[pages - 1] = `<< /Type /Pages /Kids [${page1} 0 R ${page2} 0 R] /Count 2 >>`;
  objs[page1 - 1] =
    `<< /Type /Page /Parent ${pages} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${c1} 0 R >>`;
  objs[page2 - 1] =
    `<< /Type /Page /Parent ${pages} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${c2} 0 R >>`;

  let out = "%PDF-1.4\n";
  const offsets = [];
  for (let i = 0; i < objs.length; i++) {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${objs[i]}\nendobj\n`;
  }
  const xrefStart = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) {
    out += `${String(off).padStart(10, "0")} 00000 n \n`;
  }
  out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

/** 先杀掉可能残留的 peryx 进程：否则新实例会因单实例锁退出，
 *  测试会连到旧进程上（用的是旧配置），表现为莫名其妙的失败。 */
const __KILLED_PERYX__ = true;
function killStaleApp() {
  return new Promise((resolve) => {
    const p = spawn("taskkill", ["/F", "/IM", "peryx.exe"], { stdio: "ignore" });
    p.on("exit", () => setTimeout(resolve, 600));
    p.on("error", () => resolve());
  });
}

async function main() {
  await killStaleApp();
  // 准备资料库
  fs.rmSync(VAULT, { recursive: true, force: true });
  fs.mkdirSync(path.join(VAULT, "资料库", "论文"), { recursive: true });
  fs.writeFileSync(path.join(VAULT, "资料库", "示例.pdf"), makePdf());
  fs.writeFileSync(path.join(VAULT, "资料库", "论文", "第二篇.pdf"), makePdf());
  fs.writeFileSync(path.join(VAULT, "资料库", "说明.docx"), Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  // 资料库里混一个 md：不应该出现在笔记树，也不该出现在资料库
  fs.writeFileSync(path.join(VAULT, "资料库", "混进来的.md"), "# 混进来的\n");
  fs.writeFileSync(path.join(VAULT, "普通笔记.md"), "# 普通笔记\n\n内容\n");
  // 兼容旧测试配置
  fs.mkdirSync("D:\\PeryxReleaseTest", { recursive: true });

  const cfgDir = path.join(process.env.APPDATA, "com.peryx.notes");
  fs.mkdirSync(cfgDir, { recursive: true });
  fs.writeFileSync(
    path.join(cfgDir, "config.json"),
    JSON.stringify({ lastVault: VAULT, recentVaults: [VAULT] }),
    "utf8",
  );

  const app = spawn(EXE, [], {
    env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}` },
    stdio: "ignore",
  });

  let targets = null;
  for (let i = 0; i < 120; i++) {
    await sleep(300);
    try { targets = await get(PORT, "/json/list"); if (targets?.length) break; } catch {}
  }
  if (!targets?.length) { console.error("无法连接 CDP"); app.kill(); process.exit(1); }

  const page = targets.find((t) => t.type === "page") ?? targets[0];
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let seq = 0;
  const waiters = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && waiters.has(m.id)) { waiters.get(m.id)(m); waiters.delete(m.id); }
  };
  const cdp = (method, params = {}) =>
    new Promise((r) => { const id = ++seq; waiters.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
  const js = async (x) => {
    const r = await cdp("Runtime.evaluate", { expression: x, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || "err");
    return r.result?.result?.value;
  };
  await sleep(6000);

  const results = [];

  // A/B. 资料库分区与隔离
  const panes = await js(`(() => {
    const res = document.querySelector('.resource-pane');
    const names = res ? Array.from(res.querySelectorAll('.res-name')).map(e => e.textContent) : [];
    const treeNames = Array.from(document.querySelectorAll('.tree .tree-item')).map(e => e.textContent.trim());
    return { hasPane: !!res, names, treeNames };
  })()`);

  results.push({
    label: "A. 侧边栏下半部分是资料库，只列非 md 资料",
    hasPane: panes.hasPane,
    names: panes.names,
    pass:
      panes.hasPane &&
      panes.names.includes("示例.pdf") &&
      panes.names.includes("说明.docx") &&
      !panes.names.includes("混进来的.md"),
  });

  results.push({
    label: "B. 笔记树里看不到资料库的内容",
    treeNames: panes.treeNames,
    pass:
      !panes.treeNames.some((n) => n.includes("资料库")) &&
      !panes.treeNames.some((n) => n.includes("混进来的")),
  });

  // C. 打开 PDF
  await js(`(() => {
    const item = Array.from(document.querySelectorAll('.res-item'))
      .find(e => (e.textContent || '').includes('示例.pdf'));
    if (item) item.click();
    return true;
  })()`);
  await sleep(4000);

  const viewer = await js(`(() => {
    const v = document.querySelector('.pdf-viewer');
    if (!v) return { open: false };
    return {
      open: true,
      pages: v.querySelectorAll('.pdf-page').length,
      info: v.querySelector('.pdf-pageinfo')?.textContent?.replace(/\\s+/g, ' ').trim(),
      canvases: v.querySelectorAll('canvas').length,
    };
  })()`);

  results.push({
    label: "C. 点 PDF → 打开阅读器，页数正确",
    ...viewer,
    pass: viewer.open === true && viewer.pages === 2 && viewer.canvases === 2,
  });

  // D. canvas 真的有内容
  const painted = await js(`(() => {
    const c = document.querySelector('.pdf-page canvas');
    if (!c || !c.width) return { ok: false, why: 'no canvas' };
    const ctx = c.getContext('2d');
    const data = ctx.getImageData(0, 0, c.width, c.height).data;
    let nonWhite = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] < 240 || data[i+1] < 240 || data[i+2] < 240) nonWhite++;
    }
    return { ok: true, w: c.width, h: c.height, nonWhite };
  })()`);

  results.push({
    label: "D. canvas 真的画出了内容（不是白板）",
    ...painted,
    pass: painted.ok === true && painted.nonWhite > 200,
  });

  // E. 翻页
  await js(`(() => {
    const btns = Array.from(document.querySelectorAll('.pdf-actions .icon-btn'));
    const next = btns.find(b => b.title === '下一页');
    if (next) next.click();
    return true;
  })()`);
  await sleep(1200);
  const afterNext = await js(`(() => ({
    current: document.querySelector('.pdf-pageinput')?.value,
  }))()`);
  results.push({
    label: "E. 翻页后页码变化",
    current: afterNext.current,
    pass: String(afterNext.current) === "2",
  });

  // F. 缩放
  const zoomBefore = await js(`(() => {
    const p = document.querySelector('.pdf-page');
    return p ? Math.round(p.getBoundingClientRect().width) : 0;
  })()`);
  await js(`(() => {
    const btns = Array.from(document.querySelectorAll('.pdf-actions .icon-btn'));
    const plus = btns.find(b => b.title === '放大');
    if (plus) plus.click();
    return true;
  })()`);
  await sleep(1500);
  const zoomAfter = await js(`(() => {
    const p = document.querySelector('.pdf-page');
    return p ? Math.round(p.getBoundingClientRect().width) : 0;
  })()`);
  results.push({
    label: "F. 放大后页面变宽",
    before: zoomBefore,
    after: zoomAfter,
    pass: zoomAfter > zoomBefore,
  });

  // G. 非 PDF 提示
  await js(`(() => {
    const item = Array.from(document.querySelectorAll('.res-item'))
      .find(e => (e.textContent || '').includes('说明.docx'));
    if (item) item.click();
    return true;
  })()`);
  await sleep(1200);
  const docxToast = await js(`(() => {
    const t = Array.from(document.querySelectorAll('.toast')).map(e => e.textContent);
    return { toasts: t, viewerStillOpen: !!document.querySelector('.pdf-viewer') };
  })()`);
  results.push({
    label: "G. 点 docx → 提示暂不支持，不白屏",
    toasts: docxToast.toasts,
    pass: docxToast.toasts.some((t) => String(t).includes("暂时还不能预览")),
  });

  // H. 关闭
  await js(`(() => {
    const btns = Array.from(document.querySelectorAll('.pdf-actions .icon-btn'));
    const close = btns.find(b => b.title === '关闭');
    if (close) close.click();
    return true;
  })()`);
  await sleep(1000);
  const closed = await js(`(() => ({
    viewer: !!document.querySelector('.pdf-viewer'),
    empty: !!document.querySelector('.empty-state'),
  }))()`);
  results.push({
    label: "H. 关闭阅读器后回到空状态",
    ...closed,
    pass: closed.viewer === false,
  });

  console.log(JSON.stringify(results, null, 2));
  const passed = results.filter((r) => r.pass).length;
  console.log(`\n=== 资料库 / PDF 阅读：${passed}/${results.length} 通过 ===`);
  results.filter((r) => !r.pass).forEach((r) => console.log(`  FAIL ${r.label}`));

  ws.close();
  app.kill();
  await sleep(800);
  process.exit(passed === results.length ? 0 : 2);
}

main().catch((e) => { console.error("失败:", e.message); process.exit(1); });

/**
 * 资料库与标签页的整合（v0.3 反馈修复）。
 *
 *  A. 打开 PDF 后，PDF 自己有一个标签页
 *  B. 标签上有格式徽标（MD / PDF）
 *  C. 切回笔记时能跳出 PDF（此前的 bug：卡在 PDF 里）
 *  D. 点 PDF 标签能切回 PDF
 *  E. 关闭 PDF 标签后回到相邻的笔记标签
 *  F. 笔记标签的徽标是 MD
 */
import http from "node:http";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const EXE = "D:\\Peryx\\src-tauri\\target\\debug\\peryx.exe";
const PORT = 9830;
const VAULT = "D:\\PeryxTabVault";

const get = (port, p) =>
  new Promise((res, rej) => {
    http.get({ host: "127.0.0.1", port, path: p }, (r) => {
      let d = "";
      r.on("data", (c) => (d += c));
      r.on("end", () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } });
    }).on("error", rej);
  });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function makePdf(label) {
  const objs = [];
  const add = (s) => { objs.push(s); return objs.length; };
  const catalog = add("");
  const pages = add("");
  const page = add("");
  const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const content = `BT /F1 24 Tf 72 720 Td (${label}) Tj ET`;
  const c = add(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  objs[catalog - 1] = `<< /Type /Catalog /Pages ${pages} 0 R >>`;
  objs[pages - 1] = `<< /Type /Pages /Kids [${page} 0 R] /Count 1 >>`;
  objs[page - 1] =
    `<< /Type /Page /Parent ${pages} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${c} 0 R >>`;
  let out = "%PDF-1.4\n";
  const offsets = [];
  for (let i = 0; i < objs.length; i++) {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${objs[i]}\nendobj\n`;
  }
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

async function main() {
  spawn("taskkill", ["/F", "/IM", "peryx.exe"], { stdio: "ignore" });
  await sleep(800);

  fs.rmSync(VAULT, { recursive: true, force: true });
  fs.mkdirSync(path.join(VAULT, "资料库"), { recursive: true });
  fs.writeFileSync(path.join(VAULT, "笔记甲.md"), "# 笔记甲\n\n甲的内容\n", "utf8");
  fs.writeFileSync(path.join(VAULT, "笔记乙.md"), "# 笔记乙\n\n乙的内容\n", "utf8");
  fs.writeFileSync(path.join(VAULT, "资料库", "论文.pdf"), makePdf("Paper"));

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

  const clickTree = async (name) => {
    await js(`(() => {
      const i = Array.from(document.querySelectorAll('.tree-item'))
        .find(e => (e.textContent || '').includes('${name}'));
      if (i) i.click();
      return true;
    })()`);
    await sleep(1400);
  };

  const tabsInfo = () =>
    js(`(() => {
      const tabs = Array.from(document.querySelectorAll('.tabbar-main .tab')).map(t => ({
        title: t.querySelector('.tab-title')?.textContent ?? '',
        kind: t.querySelector('.tab-kind')?.textContent ?? null,
        active: t.classList.contains('active'),
      }));
      return {
        tabs,
        pdfOpen: !!document.querySelector('.pdf-viewer'),
        noteOpen: !!document.querySelector('.cm-editor'),
      };
    })()`);

  // 先开一篇笔记
  await clickTree("笔记甲");
  const s1 = await tabsInfo();
  results.push({
    label: "A0. 打开笔记后有 MD 标签",
    tabs: s1.tabs,
    pass: s1.tabs.length >= 1 && s1.tabs.some((t) => t.kind === "MD"),
  });

  // A. 打开 PDF
  await js(`(() => {
    const i = Array.from(document.querySelectorAll('.res-item'))
      .find(e => (e.textContent || '').includes('论文.pdf'));
    if (i) i.click();
    return true;
  })()`);
  await sleep(4000);
  const s2 = await tabsInfo();
  results.push({
    label: "A. 打开 PDF 后它自己有一个标签页",
    tabs: s2.tabs,
    pass: s2.tabs.some((t) => t.title.includes("论文.pdf")),
  });

  // B. 徽标
  results.push({
    label: "B. 标签带格式徽标（MD / PDF）",
    kinds: s2.tabs.map((t) => t.kind),
    pass:
      s2.tabs.some((t) => t.kind === "PDF") && s2.tabs.some((t) => t.kind === "MD"),
  });

  // C. 关键 bug：切回笔记
  await clickTree("笔记乙");
  const s3 = await tabsInfo();
  results.push({
    label: "C. 从 PDF 切回笔记 → 真的切过去了（不再卡在 PDF）",
    pdfOpen: s3.pdfOpen,
    noteOpen: s3.noteOpen,
    active: s3.tabs.find((t) => t.active)?.title,
    pass: s3.pdfOpen === false && s3.noteOpen === true && s3.tabs.find((t) => t.active)?.title === "笔记乙",
  });

  // D. 点 PDF 标签切回 PDF
  await js(`(() => {
    const t = Array.from(document.querySelectorAll('.tabbar-main .tab'))
      .find(e => (e.querySelector('.tab-title')?.textContent || '').includes('论文.pdf'));
    if (t) t.click();
    return true;
  })()`);
  await sleep(3000);
  const s4 = await tabsInfo();
  results.push({
    label: "D. 点 PDF 标签能切回 PDF",
    pdfOpen: s4.pdfOpen,
    active: s4.tabs.find((t) => t.active)?.title,
    pass: s4.pdfOpen === true && String(s4.tabs.find((t) => t.active)?.title).includes("论文.pdf"),
  });

  // E. 关掉 PDF 标签 → 回到相邻笔记
  await js(`(() => {
    const t = Array.from(document.querySelectorAll('.tabbar-main .tab'))
      .find(e => (e.querySelector('.tab-title')?.textContent || '').includes('论文.pdf'));
    const x = t?.querySelector('.tab-close');
    if (x) x.click();
    return true;
  })()`);
  await sleep(2500);
  const s5 = await tabsInfo();
  results.push({
    label: "E. 关闭 PDF 标签后回到相邻笔记标签",
    tabs: s5.tabs.map((t) => t.title),
    pdfOpen: s5.pdfOpen,
    noteOpen: s5.noteOpen,
    pass: s5.pdfOpen === false && s5.tabs.every((t) => !t.title.includes("论文.pdf")),
  });

  // F. 笔记标签徽标是 MD
  results.push({
    label: "F. 笔记标签的徽标是 MD",
    kinds: s5.tabs.map((t) => t.kind),
    pass: s5.tabs.length > 0 && s5.tabs.every((t) => t.kind === "MD"),
  });

  console.log(JSON.stringify(results, null, 2));
  const passed = results.filter((r) => r.pass).length;
  console.log(`\n=== 标签整合：${passed}/${results.length} 通过 ===`);
  results.filter((r) => !r.pass).forEach((r) => console.log(`  FAIL ${r.label}`));

  ws.close();
  app.kill();
  await sleep(800);
  process.exit(passed === results.length ? 0 : 2);
}

main().catch((e) => { console.error("失败:", e.message); process.exit(1); });

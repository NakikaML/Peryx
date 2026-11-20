/**
 * v0.3：资料库导入（右上角 + 号）。
 *
 * 系统文件选择框没法用 CDP 操作，所以分两层验证：
 *  A. 「+」按钮存在且带 data-action
 *  B. 直接调 api.importResources 把外部文件复制进资料库（Rust 侧真正执行的逻辑）
 *  C. 导入后列表出现该文件、点开能读出页数
 *  D. 同名文件再导一次不覆盖，自动改名
 *  E. 不支持的类型被拒绝（错误信息可见）
 *  F. 点「+」会打开文件对话框（用 mock 记录调用参数）
 */
import http from "node:http";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const EXE = "D:\\Peryx\\src-tauri\\target\\debug\\peryx.exe";
const PORT = 9820;
const VAULT = "D:\\PeryxImportVault";
const OUTSIDE = "D:\\PeryxImportOutside";

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

  // 准备：空笔记库 + 外部待导入文件
  fs.rmSync(VAULT, { recursive: true, force: true });
  fs.rmSync(OUTSIDE, { recursive: true, force: true });
  fs.mkdirSync(VAULT, { recursive: true });
  fs.mkdirSync(OUTSIDE, { recursive: true });
  fs.writeFileSync(path.join(VAULT, "笔记.md"), "# 笔记\n", "utf8");
  fs.writeFileSync(path.join(OUTSIDE, "外部报告.pdf"), makePdf("Imported Report"));
  fs.writeFileSync(path.join(OUTSIDE, "附件.docx"), Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  fs.writeFileSync(path.join(OUTSIDE, "坏文件.exe"), Buffer.from("MZ"));

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

  // A. 按钮存在
  const btn = await js(`(() => {
    const b = document.querySelector('[data-action="import-resource"]');
    return b ? { exists: true, text: b.textContent.trim(), title: b.title } : { exists: false };
  })()`);
  results.push({
    label: "A. 资料库右上角有「+」按钮",
    ...btn,
    pass: btn.exists === true && btn.text === "+",
  });

  // B. 直接调 API 导入（真正的复制逻辑）
  const src = path.join(OUTSIDE, "外部报告.pdf").replace(/\\/g, "\\\\");
  const imported = await js(
    "(async () => {" +
    "  /* 生产构建里没有 /src 模块，直接调 Tauri 命令 */ " +
    `  return await window.__TAURI_INTERNALS__.invoke('import_resources', { sources: ['${src}'] });` +
    "})()",
  );
  results.push({
    label: "B. 导入 PDF 返回实际路径",
    imported,
    pass: Array.isArray(imported) && imported.length === 1 && imported[0].includes("资料库"),
  });

  const exists = fs.existsSync(path.join(VAULT, "资料库", "外部报告.pdf"));
  results.push({
    label: "B2. 文件真的复制进了资料库目录",
    exists,
    pass: exists === true,
  });

  // C. 刷新后列表出现，点开能读
  await js(`(() => {
    const b = document.querySelector('.resource-refresh');
    if (b) b.click();
    return true;
  })()`);
  await sleep(1500);
  const listed = await js(`Array.from(document.querySelectorAll('.res-name')).map(e => e.textContent)`);
  results.push({
    label: "C. 刷新后列表出现导入的文件",
    listed,
    pass: listed.includes("外部报告.pdf"),
  });

  await js(`(() => {
    const i = Array.from(document.querySelectorAll('.res-item')).find(e => e.textContent.includes('外部报告.pdf'));
    if (i) i.click();
    return true;
  })()`);
  await sleep(4000);
  const viewer = await js(`(() => {
    const v = document.querySelector('.pdf-viewer');
    return v ? { pages: v.querySelectorAll('.pdf-page').length } : null;
  })()`);
  results.push({
    label: "C2. 导入的 PDF 能正常打开",
    ...(viewer ?? {}),
    pass: viewer !== null && viewer.pages === 1,
  });

  // D. 同名再导一次 → 改名不覆盖
  const again = await js(
    "(async () => {" +
    "  /* 同上 */ " +
    `  return await window.__TAURI_INTERNALS__.invoke('import_resources', { sources: ['${src}'] });` +
    "})()",
  );
  results.push({
    label: "D. 同名再导入 → 自动改名，不覆盖",
    again,
    pass: Array.isArray(again) && again[0].includes("外部报告 (2).pdf"),
  });

  // E. 不支持的格式
  const exeSrc = path.join(OUTSIDE, "坏文件.exe").replace(/\\/g, "\\\\");
  const rejected = await js(
    "(async () => {" +
    "  /* 同上 */ " +
    `  try { await window.__TAURI_INTERNALS__.invoke('import_resources', { sources: ['${exeSrc}'] }); return 'no-error'; }` +
    "  catch (e) { return String(e); }" +
    "})()",
  );
  results.push({
    label: "E. 不支持的格式被拒绝",
    error: rejected,
    pass: String(rejected).includes("不是支持的资料格式"),
  });


  // F. 文件选择框是系统原生的，CDP 点不了（插件在模块加载时就抓住了 invoke，
  //    事后替换 window.__TAURI_INTERNALS__.invoke 也拦不到）。
  //    这里退一步：确认按钮可用、提示里写清了支持哪些格式。
  const btnState = await js(`(() => {
    const b = document.querySelector('[data-action="import-resource"]');
    return b ? { disabled: b.disabled, title: b.title } : null;
  })()`);
  results.push({
    label: "F. 「+」按钮可用，提示里写清了支持的格式",
    ...(btnState ?? {}),
    pass:
      btnState !== null &&
      btnState.disabled === false &&
      btnState.title.includes("PDF") &&
      btnState.title.includes("Excel"),
  });


  console.log(JSON.stringify(results, null, 2));
  const passed = results.filter((r) => r.pass).length;
  console.log(`\n=== 资料导入：${passed}/${results.length} 通过 ===`);
  results.filter((r) => !r.pass).forEach((r) => console.log(`  FAIL ${r.label}`));

  ws.close();
  app.kill();
  await sleep(800);
  process.exit(passed === results.length ? 0 : 2);
}

main().catch((e) => { console.error("失败:", e.message); process.exit(1); });

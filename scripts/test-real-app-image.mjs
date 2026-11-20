/**
 * 真实应用端到端验证：
 * 通过 WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS 打开 CDP，
 * 直接检查 running 的 peryx.exe 里图片是否渲染出来。
 */
import http from "node:http";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const EXE = "D:\\Peryx\\src-tauri\\target\\debug\\peryx.exe";
const PORT = 9333;

function get(port, p) {
  return new Promise((res, rej) => {
    http.get({ host: "127.0.0.1", port, path: p }, (r) => {
      let d = "";
      r.on("data", (c) => (d += c));
      r.on("end", () => {
        try { res(JSON.parse(d)); } catch (e) { rej(e); }
      });
    }).on("error", rej);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  if (!fs.existsSync(EXE)) {
    console.error("找不到 exe:", EXE);
    process.exit(1);
  }

  // 启动真实应用，并让 WebView2 打开 CDP
  const app = spawn(EXE, [], {
    env: {
      ...process.env,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}`,
    },
    stdio: "ignore",
  });

  let targets = null;
  for (let i = 0; i < 100; i++) {
    await sleep(300);
    try {
      targets = await get(PORT, "/json/list");
      if (targets?.length) break;
    } catch { /* 还没起来 */ }
  }
  if (!targets?.length) {
    console.error("无法连接 WebView2 CDP");
    app.kill();
    process.exit(1);
  }

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

  // 等界面加载 + 索引构建
  await sleep(4000);

  const results = [];

  // 1. 是否恢复到了测试笔记库
  const vault = await js(`(() => {
    const el = document.querySelector('.vault-text');
    return el ? el.textContent : null;
  })()`);
  results.push({
    label: "1. 启动即恢复笔记库",
    vault,
    pass: vault === "PeryxPicVault",
  });

  // 2. 打开笔记
  await js(`(() => {
    const items = Array.from(document.querySelectorAll('.tree-item'));
    const note = items.find(e => (e.textContent || '').indexOf('图片测试') >= 0);
    if (note) note.click();
    return true;
  })()`);
  await sleep(2500);

  // 3. 内嵌图片是否渲染
  const embed = await js(`(() => {
    const imgs = Array.from(document.querySelectorAll('.cm-embed-img'));
    const failed = Array.from(document.querySelectorAll('.cm-embed-failed'));
    const pending = Array.from(document.querySelectorAll('.cm-embed-ph'));
    return {
      imgCount: imgs.length,
      srcs: imgs.map(e => e.src.slice(0, 30)),
      natural: imgs.map(e => ({ w: e.naturalWidth, h: e.naturalHeight })),
      failedTexts: failed.map(e => e.textContent),
      pendingTexts: pending.map(e => e.textContent),
    };
  })()`);

  results.push({
    label: "2. ![[图片]] 在真实应用中渲染成功",
    ...embed,
    pass: embed.imgCount === 2 && embed.natural.every((d) => d.w > 0),
  });

  // 4. 文件树里也有图片（需要先展开 Picture 文件夹）
  await js(`(() => {
    const items = Array.from(document.querySelectorAll('.tree-item'));
    const dir = items.find(e => (e.querySelector('.tree-label')?.textContent || '') === 'Picture');
    if (dir) dir.click();
    return true;
  })()`);
  await sleep(1500);

  const tree = await js(`(() => {
    const items = Array.from(document.querySelectorAll('.tree-item'));
    return {
      labels: items.map(e => e.querySelector('.tree-label')?.textContent),
      imageIcons: items.filter(e => e.querySelector('.tree-icon.is-image')).length,
    };
  })()`);
  results.push({
    label: "3. 文件树列出图片",
    ...tree,
    pass: tree.imageIcons === 1 && tree.labels.some((l) => (l || "").includes(".png")),
  });

  console.log(JSON.stringify(results, null, 2));
  const passed = results.filter((r) => r.pass).length;
  console.log(`\n=== 真实应用验证：${passed}/${results.length} 通过 ===`);
  results.filter((r) => !r.pass).forEach((r) => console.log(`  FAIL ${r.label}`));

  ws.close();
  app.kill();
  await sleep(800);
  process.exit(passed === results.length ? 0 : 2);
}

main().catch((e) => {
  console.error("验证失败:", e.message);
  process.exit(1);
});

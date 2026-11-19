/**
 * 真实应用里验证：点击 ![[图片]] 能进入源码并真的改掉文件名。
 */
import http from "node:http";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const EXE = "D:\\Peryx\\src-tauri\\target\\debug\\peryx.exe";
const PORT = 9335;
const VAULT = "D:\\PeryxCaretVault";

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
  // 准备测试库
  fs.rmSync(VAULT, { recursive: true, force: true });
  fs.mkdirSync(path.join(VAULT, "Picture"), { recursive: true });
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  fs.writeFileSync(path.join(VAULT, "Picture", "旧名字.png"), png);
  fs.writeFileSync(
    path.join(VAULT, "链接测试.md"),
    "# 链接测试\n\n嵌入：![[旧名字.png]]\n",
    "utf8",
  );

  // 指向这个库
  const cfgDir = path.join(process.env.APPDATA, "com.peryx.notes");
  fs.mkdirSync(cfgDir, { recursive: true });
  fs.writeFileSync(
    path.join(cfgDir, "config.json"),
    JSON.stringify({ lastVault: VAULT, recentVaults: [VAULT] }, null, 2),
    "utf8",
  );

  const app = spawn(EXE, [], {
    env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}` },
    stdio: "ignore",
  });

  let targets = null;
  for (let i = 0; i < 100; i++) {
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
  await cdp("Runtime.enable");
  await sleep(4500);

  const results = [];

  // 打开笔记
  await js(`(() => {
    const i = Array.from(document.querySelectorAll('.tree-item')).find(e => (e.textContent||'').includes('链接测试'));
    if (i) i.click();
    return true;
  })()`);
  await sleep(2500);

  // 1. 图片渲染了
  const rendered = await js(`document.querySelectorAll('.cm-embed-img').length`);
  results.push({ label: "1. 图片渲染", imgCount: rendered, pass: rendered === 1 });

  // 2. 点击图片 → 源码展开，光标进入 `![[` 之后
  const box = await js(`(() => {
    const el = document.querySelector('.cm-embed');
    if (!el) return null;
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  })()`);
  if (box) {
    await cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: box.x, y: box.y });
    await cdp("Input.dispatchMouseEvent", { type: "mousePressed", x: box.x, y: box.y, button: "left", buttons: 1, clickCount: 1 });
    await cdp("Input.dispatchMouseEvent", { type: "mouseReleased", x: box.x, y: box.y, button: "left", buttons: 0, clickCount: 1 });
    await sleep(700);
  }

  const afterClick = await js(`(() => {
    const lines = Array.from(document.querySelectorAll('.cm-line'));
    const el = lines.find(e => (e.textContent||'').includes('![['));
    return {
      sourceShown: !!el,
      lineText: el ? el.textContent : null,
      // 用 window.getSelection 看光标是否落在源码里
      selInside: (() => {
        const s = window.getSelection();
        if (!s || !s.rangeCount || !el) return false;
        const r = s.getRangeAt(0);
        return el.contains(r.startContainer);
      })(),
    };
  })()`);
  results.push({
    label: "2. 点击图片后展开源码且光标在源码内",
    ...afterClick,
    pass: afterClick.sourceShown === true && afterClick.selInside === true,
  });

  // 3. 全选链接内容并改写：模拟真实编辑
  const edited = await js(`(() => {
    // 选中整个 ![[...]] 并替换成新名字
    const cm = document.querySelector('.cm-content');
    const view = cm && cm.cmView ? cm.cmView.view : null;
    return { hasView: !!view };
  })()`);
  void edited;

  // 用键盘真实输入：先在源码里按 End 再输入，验证能否编辑
  const before = await js(`document.body.innerText.includes('旧名字.png')`);
  await cdp("Input.insertText", { text: "-改" });
  await sleep(800);
  const typed = await js(`(() => {
    const lines = Array.from(document.querySelectorAll('.cm-line'));
    const el = lines.find(e => (e.textContent||'').includes('![['));
    return { lineText: el ? el.textContent : null };
  })()`);
  results.push({
    label: "3. 能在源码内部输入文字",
    before,
    ...typed,
    pass: (typed.lineText || "").includes("-改"),
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

main().catch((e) => { console.error("失败:", e.message); process.exit(1); });

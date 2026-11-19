/**
 * 在真实应用（peryx.exe）里验证拖标签分屏。
 * 通过 WebView2 的 CDP 发真实鼠标事件。
 */
import http from "node:http";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const EXE = "D:\\Peryx\\src-tauri\\target\\debug\\peryx.exe";
const PORT = 9340;
const VAULT = "D:\\PeryxDragVault";

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
  fs.rmSync(VAULT, { recursive: true, force: true });
  fs.mkdirSync(VAULT, { recursive: true });
  fs.writeFileSync(path.join(VAULT, "甲.md"), "# 甲笔记\n\n甲的内容。\n", "utf8");
  fs.writeFileSync(path.join(VAULT, "乙.md"), "# 乙笔记\n\n乙的内容。\n", "utf8");

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
  await sleep(5000);

  const mouse = async (type, x, y) =>
    cdp("Input.dispatchMouseEvent", {
      type, x, y, button: "left", buttons: type === "mouseReleased" ? 0 : 1, clickCount: 1,
    });

  const results = [];

  // 打开两篇笔记
  for (const name of ["甲", "乙"]) {
    await js(`(() => {
      const i = Array.from(document.querySelectorAll('.tree-item'))
        .find(e => (e.textContent || '').includes('${name}'));
      if (i) i.click();
      return true;
    })()`);
    await sleep(1200);
  }

  const before = await js(`(() => ({
    mainTabs: Array.from(document.querySelectorAll('.tabbar-main .tab-title')).map(e => e.textContent),
    hasSplit: !!document.querySelector('.split-pane'),
  }))()`);

  // 拖动「甲」到右边缘
  const from = await js(`(() => {
    const tab = Array.from(document.querySelectorAll('.tabbar-main .tab'))
      .find(e => (e.querySelector('.tab-title')?.textContent || '') === '甲');
    if (!tab) return null;
    const r = tab.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  })()`);
  const pane = await js(`(() => {
    const el = document.querySelector('.pane-area');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  })()`);

  if (from && pane) {
    const to = { x: Math.round(pane.left + pane.width * 0.95), y: Math.round(pane.top + pane.height * 0.5) };
    await mouse("mousePressed", from.x, from.y);
    for (let i = 1; i <= 6; i++) {
      await mouse("mouseMoved", Math.round(from.x + ((to.x - from.x) * i) / 6), Math.round(from.y + ((to.y - from.y) * i) / 6));
      await sleep(40);
    }
    await sleep(250);
    // 松手前先看热区
    const zones = await js(`document.querySelectorAll('.drop-zone').length`);
    await mouse("mouseReleased", to.x, to.y);
    await sleep(1600);

    const after = await js(`(() => ({
      workspaceClass: document.querySelector('.workspace')?.className ?? null,
      mainTabs: Array.from(document.querySelectorAll('.tabbar-main .tab-title')).map(e => e.textContent),
      sideTabs: Array.from(document.querySelectorAll('.tabbar-side .tab-title')).map(e => e.textContent),
      sideHeading: document.querySelector('.split-pane .cm-line')?.textContent ?? null,
      zoneCount: document.querySelectorAll('.drop-zone').length,
    }))()`);

    results.push({
      label: "1. 拖动时出现热区",
      zones,
      pass: zones === 4,
    });
    results.push({
      label: "2. 松手后右侧出现分屏，标签移动过去",
      ...after,
      pass:
        String(after.workspaceClass || "").includes("split-right") &&
        (after.sideTabs || []).includes("甲") &&
        !(after.mainTabs || []).includes("甲") &&
        after.zoneCount === 0,
    });
  } else {
    results.push({ label: "准备失败", from, pane, pass: false });
  }

  void before;

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

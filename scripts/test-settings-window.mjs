/**
 * Obsidian 式设置窗口：
 *  A. 左侧一栏导航，右侧内容
 *  B. 点导航切换右侧内容
 *  C. 拖右下角能改变窗口大小
 *  D. 尺寸会被记住（关掉重开还是那个大小）
 *  E. 窗口有最小尺寸，拖再小也不会崩
 */
import http from "node:http";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9751;
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
  const profile = path.join(process.env.TEMP, "peryx-setwin-" + Date.now());
  const chrome = spawn(CHROME, [
    "--headless=new", "--disable-gpu", "--no-first-run",
    `--user-data-dir=${profile}`, `--remote-debugging-port=${PORT}`,
    "--window-size=1400,1000", "http://localhost:1420/preview.html?page=settings",
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

  const mouse = (type, x, y) =>
    cdp("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons: type === "mouseReleased" ? 0 : 1, clickCount: 1 });

  const size = () =>
    js(`(() => {
      const r = document.querySelector('.settings').getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height) };
    })()`);

  // A. 左右两栏
  const layout = await js(`(() => {
    const nav = document.querySelector('.settings-nav');
    const content = document.querySelector('.settings-content');
    if (!nav || !content) return { ok: false };
    const n = nav.getBoundingClientRect();
    const c = content.getBoundingClientRect();
    return {
      ok: true,
      navLeft: Math.round(n.left),
      navRight: Math.round(n.right),
      contentLeft: Math.round(c.left),
      navWidth: Math.round(n.width),
      items: Array.from(document.querySelectorAll('.settings-nav-item')).map(e => e.textContent.trim()),
      oldTabs: document.querySelectorAll('.settings-tab').length,
    };
  })()`);

  results.push({
    label: "A. 左侧导航 + 右侧内容两栏布局",
    ...layout,
    pass:
      layout.ok === true &&
      layout.navWidth > 100 &&
      layout.contentLeft >= layout.navRight - 2 &&
      layout.oldTabs === 0,
  });

  // B. 点导航切换内容
  const switched = await js(`(() => {
    const item = document.querySelector('[data-settings-tab="keys"]');
    if (!item) return { err: 'no keys nav' };
    item.click();
    return { ok: true };
  })()`);
  await sleep(700);
  const afterSwitch = await js(`(() => ({
    title: document.querySelector('.settings-pane-title')?.textContent?.trim(),
    shortcuts: document.querySelectorAll('.shortcut-row').length,
    activeNav: document.querySelector('.settings-nav-item.active')?.textContent?.trim(),
    themeCards: document.querySelectorAll('.theme-card').length,
  }))()`);

  results.push({
    label: "B. 点左侧「快捷键」→ 右侧切到快捷键内容",
    switched,
    title: afterSwitch.title,
    shortcuts: afterSwitch.shortcuts,
    pass:
      afterSwitch.title === "快捷键" &&
      afterSwitch.shortcuts > 5 &&
      afterSwitch.themeCards === 0 &&
      String(afterSwitch.activeNav).includes("快捷键"),
  });

  // C. 拖右下角调整大小
  const before = await size();
  const handle = await js(`(() => {
    const r = document.querySelector('.settings-resize').getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  })()`);

  await mouse("mousePressed", handle.x, handle.y);
  for (let i = 1; i <= 5; i++) {
    await mouse("mouseMoved", handle.x - 60 + i * 40, handle.y - 50 + i * 30);
    await sleep(40);
  }
  await mouse("mouseReleased", handle.x + 140, handle.y + 100);
  await sleep(600);
  const after = await size();

  results.push({
    label: "C. 拖右下角 → 窗口变大",
    before,
    after,
    pass: after.w > before.w + 50 && after.h > before.h + 40,
  });

  // E. 往左上拖到极小 → 有最小尺寸限制
  const handle2 = await js(`(() => {
    const r = document.querySelector('.settings-resize').getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  })()`);
  await mouse("mousePressed", handle2.x, handle2.y);
  for (let i = 1; i <= 5; i++) {
    await mouse("mouseMoved", handle2.x - i * 200, handle2.y - i * 200);
    await sleep(40);
  }
  await mouse("mouseReleased", handle2.x - 1000, handle2.y - 1000);
  await sleep(500);
  const tiny = await size();
  results.push({
    label: "E. 拖到极小也不会小于最小尺寸",
    size: tiny,
    pass: tiny.w >= 560 && tiny.h >= 380,
  });

  // D. 尺寸被记住：读 localStorage
  const saved = await js(`(() => {
    try { return JSON.parse(localStorage.getItem('peryx.settings.size')); } catch { return null; }
  })()`);
  results.push({
    label: "D. 调整后的尺寸被记住",
    saved,
    current: tiny,
    pass:
      saved !== null &&
      Math.abs(saved.w - tiny.w) <= 2 &&
      Math.abs(saved.h - tiny.h) <= 2,
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

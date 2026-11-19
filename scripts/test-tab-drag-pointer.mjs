/**
 * 用真实鼠标事件验证拖标签分屏（Pointer 实现，不依赖浏览器 DnD）。
 *
 *  A. 按住标签移动到右边缘 → 出现热区
 *  B. 松手 → 分屏出现在右侧，且标签从主面板移走
 *  C. 移到左边缘松手 → 分屏在左
 *  D. 移到下边缘松手 → 竖向分屏在下
 *  E. 移到中间松手 → 不产生分屏
 *  F. 单击标签不应误触发分屏
 */
import http from "node:http";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9690;
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
  const profile = path.join(process.env.TEMP, "peryx-ptr-" + Date.now());
  const chrome = spawn(CHROME, [
    "--headless=new", "--disable-gpu", "--no-first-run",
    `--user-data-dir=${profile}`, `--remote-debugging-port=${PORT}`,
    "--window-size=1500,950", "http://localhost:1420/preview.html?page=split",
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

  const mouse = async (type, x, y, extra = {}) =>
    cdp("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons: type === "mouseReleased" ? 0 : 1, clickCount: 1, ...extra });

  const openNote = async (name) => {
    await js(`(() => {
      const i = Array.from(document.querySelectorAll('.tree-item'))
        .find(e => (e.textContent || '').includes('${name}'));
      if (i) i.click();
      return true;
    })()`);
    await sleep(800);
  };

  const tabBox = (title) =>
    js(`(() => {
      const tab = Array.from(document.querySelectorAll('.tabbar-main .tab'))
        .find(e => (e.querySelector('.tab-title')?.textContent || '') === '${title}');
      if (!tab) return null;
      const r = tab.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    })()`);

  const paneBox = () =>
    js(`(() => {
      const el = document.querySelector('.pane-area');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { left: r.left, top: r.top, width: r.width, height: r.height };
    })()`);

  /** 真实拖动：按下标签，逐步移动到目标点，再松手 */
  const dragTabTo = async (title, fx, fy, { release = true } = {}) => {
    const from = await tabBox(title);
    const pane = await paneBox();
    if (!from || !pane) return false;
    const to = { x: Math.round(pane.left + pane.width * fx), y: Math.round(pane.top + pane.height * fy) };

    await mouse("mousePressed", from.x, from.y);
    // 分几步移动，触发阈值判断
    for (let i = 1; i <= 6; i++) {
      const x = Math.round(from.x + ((to.x - from.x) * i) / 6);
      const y = Math.round(from.y + ((to.y - from.y) * i) / 6);
      await mouse("mouseMoved", x, y);
      await sleep(30);
    }
    await sleep(200);
    if (release) {
      await mouse("mouseReleased", to.x, to.y);
      await sleep(1200);
    }
    return true;
  };

  const state = () =>
    js(`(() => {
      const tabs = (sel) => Array.from(document.querySelectorAll(sel + ' .tab-title')).map(e => e.textContent);
      const ws = document.querySelector('.workspace');
      return {
        workspaceClass: ws ? ws.className : null,
        mainTabs: tabs('.tabbar-main'),
        sideTabs: tabs('.tabbar-side'),
        zoneCount: document.querySelectorAll('.drop-zone').length,
        hotZones: Array.from(document.querySelectorAll('.drop-zone.hot')).map(e => e.dataset.dropSide),
        paneKids: (() => {
          const p = document.querySelector('.pane-area');
          return p ? Array.from(p.children).map(k => String(k.className || '').split(' ')[0]) : [];
        })(),
      };
    })()`);

  const results = [];

  await openNote("笔记A");
  await openNote("笔记B");

  // A. 拖到右边缘时热区出现且右侧高亮
  await dragTabTo("笔记A", 0.95, 0.5, { release: false });
  const mid = await state();
  results.push({
    label: "A. 拖动到右边缘 → 热区出现并高亮右侧",
    zoneCount: mid.zoneCount,
    hotZones: mid.hotZones,
    pass: mid.zoneCount === 2 && mid.hotZones.includes("right"),
  });

  // B. 松手 → 分屏在右，标签移动过去
  const pane = await paneBox();
  await mouse("mouseReleased", Math.round(pane.left + pane.width * 0.95), Math.round(pane.top + pane.height * 0.5));
  await sleep(1400);
  const afterRight = await state();
  results.push({
    label: "B. 松手后分屏在右，标签移动过去（主面板不再保留）",
    ...afterRight,
    pass:
      afterRight.workspaceClass.includes("split-right") &&
      afterRight.sideTabs.includes("笔记A") &&
      !afterRight.mainTabs.includes("笔记A") &&
      afterRight.zoneCount === 0,
  });

  // C. 关掉分屏，再把另一个标签拖到左边
  await js(`(() => { const b = document.querySelector('.tabbar-pane-close'); if (b) b.click(); return true; })()`);
  await sleep(900);
  await dragTabTo("笔记A", 0.05, 0.5);
  const afterLeft = await state();
  results.push({
    label: "C. 拖到左边缘 → 分屏在左",
    ...afterLeft,
    pass: afterLeft.workspaceClass.includes("split-left") && afterLeft.paneKids[0] === "split-pane",
  });

  // D. 关掉，拖到下方 → 上下分屏已下线（v0.3 再做），不应产生分屏
  await js(`(() => { const b = document.querySelector('.tabbar-pane-close'); if (b) b.click(); return true; })()`);
  await sleep(900);
  await dragTabTo("笔记B", 0.5, 0.95);
  const afterBottom = await state();
  const dir = await js(`(() => { const p = document.querySelector('.pane-area'); return p ? getComputedStyle(p).flexDirection : null; })()`);
  results.push({
    label: "D. 拖到下边缘不再产生竖向分屏（上下分屏推迟到 v0.3）",
    workspaceClass: afterBottom.workspaceClass,
    flexDirection: dir,
    zoneCount: afterBottom.zoneCount,
    pass: !afterBottom.workspaceClass.includes("split-") && dir === "row",
  });

  // E. 关掉，拖到中间松手 → 不产生分屏
  await js(`(() => { const b = document.querySelector('.tabbar-pane-close'); if (b) b.click(); return true; })()`);
  await sleep(900);
  await dragTabTo("笔记A", 0.5, 0.5);
  const afterCenter = await state();
  results.push({
    label: "E. 拖到中间松手 → 不产生分屏",
    workspaceClass: afterCenter.workspaceClass,
    paneCount: afterCenter.paneKids.filter((c) => c === "split-pane").length,
    pass: !afterCenter.workspaceClass.includes("split-") && afterCenter.paneKids.indexOf("split-pane") < 0,
  });

  // F. 单击标签不应触发分屏
  const box = await tabBox("笔记B");
  if (box) {
    await mouse("mousePressed", box.x, box.y);
    await sleep(60);
    await mouse("mouseReleased", box.x, box.y);
    await sleep(900);
  }
  const afterClick = await state();
  results.push({
    label: "F. 单击标签不误触发分屏",
    workspaceClass: afterClick.workspaceClass,
    pass: !afterClick.workspaceClass.includes("split-"),
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

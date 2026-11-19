/**
 * 拖动标签页到四个方向实现分屏：
 *  A. 拖动时出现四个投放热区
 *  B. 丢到右侧 → 分屏在右
 *  C. 丢到左侧 → 分屏在左
 *  D. 丢到下方 → 分屏在下（竖排）
 *  E. 丢到上方 → 分屏在上（竖排）
 *  F. 右侧边栏始终在最外层最右
 */
import http from "node:http";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9670;
const get = (port, p) =>
  new Promise((res, rej) => {
    http.get({ host: "127.0.0.1", port, path: p }, (r) => {
      let d = "";
      r.on("data", (c) => (d += c));
      r.on("end", () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } });
    }).on("error", rej);
  });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function openPage(url, port) {
  const profile = path.join(process.env.TEMP, "peryx-drag-" + Date.now() + "-" + port);
  const chrome = spawn(CHROME, [
    "--headless=new", "--disable-gpu", "--no-first-run",
    `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`,
    "--window-size=1500,950", url,
  ], { stdio: "ignore" });
  let t = null;
  for (let i = 0; i < 80; i++) {
    await sleep(250);
    try { t = await get(port, "/json/list"); if (t?.length) break; } catch {}
  }
  if (!t) throw new Error("无法连接 Chrome");
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
  return { chrome, ws, profile, js, cdp };
}

async function main() {
  const results = [];
  const { chrome, ws, profile, js } = await openPage(
    "http://localhost:1420/preview.html?page=split",
    PORT,
  );

  // 打开两篇笔记，形成两个标签
  for (const name of ["笔记A", "笔记B"]) {
    await js(`(() => {
      const i = Array.from(document.querySelectorAll('.tree-item'))
        .find(e => (e.textContent || '').includes('${name}'));
      if (i) i.click();
      return true;
    })()`);
    await sleep(700);
  }

  // 拖动「笔记A」这个标签
  const startDrag = (title) =>
    js(`(() => {
      const tab = Array.from(document.querySelectorAll('.tab'))
        .find(e => (e.querySelector('.tab-title')?.textContent || '') === '${title}');
      if (!tab) return { err: '找不到标签' };
      const dt = new DataTransfer();
      tab.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
      return { ok: true };
    })()`);

  const dropOn = (side) =>
    js(`(() => {
      const zone = document.querySelector('[data-drop-side="${side}"]');
      if (!zone) return { err: '没有热区 ' + '${side}' };
      const dt = new DataTransfer();
      zone.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
      zone.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
      return { ok: true };
    })()`);

  const layout = () =>
    js(`(() => {
      const ws = document.querySelector('.workspace');
      const pane = document.querySelector('.pane-area');
      return {
        workspaceClass: ws ? ws.className : null,
        paneKids: pane ? Array.from(pane.children).map(k => String(k.className || '').split(' ')[0]) : [],
        wsKids: ws ? Array.from(ws.children).map(k => String(k.className || '').split(' ')[0]) : [],
        splitTitle: document.querySelector('.split-title')?.textContent ?? null,
        zoneCount: document.querySelectorAll('.drop-zone').length,
      };
    })()`);

  // A. 拖动时出现热区
  await startDrag("笔记A");
  await sleep(500);
  const dragging = await layout();
  results.push({
    label: "A. 拖动标签时浮出四个投放热区",
    zoneCount: dragging.zoneCount,
    pass: dragging.zoneCount === 4,
  });

  // B. 丢到右侧
  await dropOn("right");
  await sleep(1400);
  const right = await layout();
  results.push({
    label: "B. 丢到右侧 → 分屏在右",
    ...right,
    pass:
      right.workspaceClass.includes("split-right") &&
      right.paneKids[0] === "editor-wrap" &&
      right.paneKids[1] === "split-pane" &&
      right.wsKids.includes("right-sidebar"),
  });

  // C. 关掉再丢左侧
  await js(`(() => { const b = Array.from(document.querySelectorAll('.split-pane .icon-btn')).find(x => (x.title||'')==='关闭分屏'); if (b) b.click(); return true; })()`);
  await sleep(800);
  await startDrag("笔记A");
  await sleep(400);
  await dropOn("left");
  await sleep(1400);
  const left = await layout();
  results.push({
    label: "C. 丢到左侧 → 分屏在左",
    ...left,
    pass: left.workspaceClass.includes("split-left") && left.paneKids[0] === "split-pane",
  });

  // D. 丢到下方
  await js(`(() => { const b = Array.from(document.querySelectorAll('.split-pane .icon-btn')).find(x => (x.title||'')==='关闭分屏'); if (b) b.click(); return true; })()`);
  await sleep(800);
  await startDrag("笔记A");
  await sleep(400);
  await dropOn("bottom");
  await sleep(1400);
  const bottom = await layout();
  const dirBottom = await js(`(() => {
    const pane = document.querySelector('.pane-area');
    return pane ? getComputedStyle(pane).flexDirection : null;
  })()`);
  results.push({
    label: "D. 丢到下方 → 竖排、分屏在下",
    workspaceClass: bottom.workspaceClass,
    flexDirection: dirBottom,
    paneKids: bottom.paneKids,
    pass:
      bottom.workspaceClass.includes("split-bottom") &&
      dirBottom === "column" &&
      bottom.paneKids[1] === "split-pane",
  });

  // E. 丢到上方
  await js(`(() => { const b = Array.from(document.querySelectorAll('.split-pane .icon-btn')).find(x => (x.title||'')==='关闭分屏'); if (b) b.click(); return true; })()`);
  await sleep(800);
  await startDrag("笔记A");
  await sleep(400);
  await dropOn("top");
  await sleep(1400);
  const top = await layout();
  results.push({
    label: "E. 丢到上方 → 竖排、分屏在上",
    workspaceClass: top.workspaceClass,
    paneKids: top.paneKids,
    pass: top.workspaceClass.includes("split-top") && top.paneKids[0] === "split-pane",
  });

  // F. 右侧边栏始终在最外层最右
  results.push({
    label: "F. 右侧边栏始终在最外层（不在 pane-area 里）",
    wsKids: top.wsKids,
    paneKids: top.paneKids,
    pass: top.wsKids.includes("right-sidebar") && !top.paneKids.includes("right-sidebar"),
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

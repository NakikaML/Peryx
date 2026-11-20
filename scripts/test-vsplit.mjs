/**
 * v0.3 第 1 项：上下分屏。
 *
 * 上次上下分屏有 bug（pane-area 竖排时编辑区不能收缩，把分屏挤出去）。
 * 根因是 .editor-wrap 缺 min-height: 0。
 *
 *  A. 拖到编辑区上缘 → 分屏在上（竖排），两块都有可见高度
 *  B. 拖到下缘 → 分屏在下
 *  C. 两个面板高度合计不超过工作区高度（不会溢出）
 *  D. 分屏里的编辑器可以正常显示内容（不是被压成 0 高）
 *  E. 上下分屏时右侧边栏仍在最右
 *  F. 左右分屏仍然正常
 */
import http from "node:http";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9760;
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
  const profile = path.join(process.env.TEMP, "peryx-vsplit-" + Date.now());
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

  const mouse = (type, x, y) =>
    cdp("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons: type === "mouseReleased" ? 0 : 1, clickCount: 1 });

  const openNote = async (name) => {
    await js(`(() => {
      const i = Array.from(document.querySelectorAll('.tree-item'))
        .find(e => (e.textContent || '').includes('${name}'));
      if (i) i.click();
      return true;
    })()`);
    await sleep(800);
  };

  /** 拖主面板标签到编辑区某个相对位置 */
  const dragTo = async (title, fx, fy) => {
    const box = await js(`(() => {
      const tab = Array.from(document.querySelectorAll('.tabbar-main .tab'))
        .find(e => (e.querySelector('.tab-title')?.textContent || '') === '${title}');
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
    if (!box || !pane) return false;
    const to = { x: Math.round(pane.left + pane.width * fx), y: Math.round(pane.top + pane.height * fy) };
    await mouse("mousePressed", box.x, box.y);
    for (let i = 1; i <= 6; i++) {
      await mouse("mouseMoved", Math.round(box.x + ((to.x - box.x) * i) / 6), Math.round(box.y + ((to.y - box.y) * i) / 6));
      await sleep(30);
    }
    await sleep(150);
    await mouse("mouseReleased", to.x, to.y);
    await sleep(1400);
    return true;
  };

  const layout = () =>
    js(`(() => {
      const ws = document.querySelector('.workspace');
      const pane = document.querySelector('.pane-area');
      const ed = document.querySelector('.editor-wrap');
      const sp = document.querySelector('.split-pane');
      const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top), bottom: Math.round(r.bottom) }; };
      return {
        workspaceClass: ws ? ws.className : null,
        direction: pane ? getComputedStyle(pane).flexDirection : null,
        pane: box(pane),
        editor: box(ed),
        split: box(sp),
        wsKids: ws ? Array.from(ws.children).map(k => String(k.className || '').split(' ')[0]) : [],
        splitLine: sp ? (sp.querySelector('.cm-line')?.textContent ?? null) : null,
        zoneCount: document.querySelectorAll('.drop-zone').length,
      };
    })()`);

  const results = [];

  // 开两篇：拖走一篇后主面板还留着一篇，右侧大纲才在
  await openNote("笔记A");
  await openNote("笔记B");

  // A. 拖到上缘
  await dragTo("笔记B", 0.5, 0.05);
  const top = await layout();
  results.push({
    label: "A. 拖到上缘 → 竖排、分屏在上",
    workspaceClass: top.workspaceClass,
    direction: top.direction,
    editor: top.editor,
    split: top.split,
    pass:
      String(top.workspaceClass).includes("split-top") &&
      top.direction === "column" &&
      top.split !== null &&
      top.split.top <= top.editor.top + 2 &&
      top.split.h > 80 &&
      top.editor.h > 80,
  });

  // D. 分屏里的内容正常显示
  results.push({
    label: "D. 上下分屏后两边都有内容、高度正常",
    splitLine: top.splitLine,
    editorH: top.editor?.h,
    splitH: top.split?.h,
    pass: (top.splitLine || "").length > 0 && top.editor.h > 80 && top.split.h > 80,
  });

  // C. 不溢出新工作区高度
  const sumH = (top.editor?.h ?? 0) + (top.split?.h ?? 0);
  results.push({
    label: "C. 两块高度合计不超过工作区（不溢出）",
    editorH: top.editor?.h,
    splitH: top.split?.h,
    paneH: top.pane?.h,
    sum: sumH,
    pass: sumH <= (top.pane?.h ?? 0) + 2,
  });

  // E. 右侧边栏仍在最外层
  results.push({
    label: "E. 上下分屏时右侧边栏仍在最外层",
    wsKids: top.wsKids,
    pass: top.wsKids.includes("right-sidebar"),
  });

  // B. 关掉后拖到下缘
  await js(`(() => { const b = document.querySelector('.tabbar-pane-close'); if (b) b.click(); return true; })()`);
  await sleep(900);
  await openNote("笔记A");
  await dragTo("笔记A", 0.5, 0.95);
  const bottom = await layout();
  results.push({
    label: "B. 拖到下缘 → 分屏在下",
    workspaceClass: bottom.workspaceClass,
    editor: bottom.editor,
    split: bottom.split,
    pass:
      String(bottom.workspaceClass).includes("split-bottom") &&
      bottom.split !== null &&
      bottom.split.top >= bottom.editor.top - 2 &&
      bottom.split.h > 80 &&
      bottom.editor.h > 80,
  });

  // F. 左右分屏仍然正常
  await js(`(() => { const b = document.querySelector('.tabbar-pane-close'); if (b) b.click(); return true; })()`);
  await sleep(900);
  await openNote("笔记A");
  await dragTo("笔记A", 0.97, 0.5);
  const right = await layout();
  results.push({
    label: "F. 左右分屏仍然正常",
    workspaceClass: right.workspaceClass,
    direction: right.direction,
    editor: right.editor,
    split: right.split,
    pass:
      String(right.workspaceClass).includes("split-right") &&
      right.direction === "row" &&
      right.split !== null &&
      right.split.w > 80 &&
      right.editor.w > 80,
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

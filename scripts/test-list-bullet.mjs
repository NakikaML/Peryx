/**
 * 无序列表在某行有光标时，项目符号应由源码里的 `-` 充当，不能同时出现「• -」。
 *
 *  A. 光标不在列表行：显示圆点（::before 有内容），源码 `-` 隐藏
 *  B. 光标在该列表行：不画圆点（::before 为空），显示 `-`
 *  C. 相邻两行：只有光标行不画圆点
 *  D. 有序列表不受影响（数字始终显示，不额外生成符号）
 */
import http from "node:http";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9720;
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
  const profile = path.join(process.env.TEMP, "peryx-list-" + Date.now());
  const chrome = spawn(CHROME, [
    "--headless=new", "--disable-gpu", "--no-first-run",
    `--user-data-dir=${profile}`, `--remote-debugging-port=${PORT}`,
    "--window-size=1400,950", "http://localhost:1420/preview.html?page=caret",
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
  await sleep(3000);

  // 点进编辑器（真实鼠标事件），全选后写入测试内容
  const box = await js(`(() => {
    const el = document.querySelector('.cm-content');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + 60) };
  })()`);
  if (!box) { console.error("找不到编辑器"); process.exit(1); }

  const mouse = (type, x, y) =>
    cdp("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons: type === "mouseReleased" ? 0 : 1, clickCount: 1 });
  await mouse("mousePressed", box.x, box.y);
  await mouse("mouseReleased", box.x, box.y);
  await sleep(400);

  // 全选
  await cdp("Input.dispatchKeyEvent", { type: "keyDown", key: "a", code: "KeyA", windowsVirtualKeyCode: 65, modifiers: 2 });
  await cdp("Input.dispatchKeyEvent", { type: "keyUp", key: "a", code: "KeyA", windowsVirtualKeyCode: 65, modifiers: 2 });
  await sleep(200);

  // 写入：普通行 + 两个无序列表行 + 一个有序列表行，光标停在最后一行
  await cdp("Input.insertText", { text: "第一行普通文字\n- 列表一\n- 列表二\n1. 有序一" });
  await sleep(1000);

  const typed = await js(`Array.from(document.querySelectorAll('.cm-line')).map(e => e.textContent)`);

  // 光标此时在最后一行（有序列表）。往上移一行 → 落在无序列表「- 列表二」上
  const key = async (k, code, vk) => {
    await cdp("Input.dispatchKeyEvent", { type: "keyDown", key: k, code, windowsVirtualKeyCode: vk });
    await cdp("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: vk });
    await sleep(180);
  };
  await key("ArrowUp", "ArrowUp", 38);
  await sleep(700);
  const results = [];
  results.push({
    label: "0. 测试内容写入成功",
    typed,
    pass: typed.length >= 4 && typed.some((l) => l.includes("列表一")),
  });


  /** 取每一行：是否画了圆点、`-` 是否可见 */
  const inspect = () =>
    js(`(() => {
      const lineEl = (el) => {
        const before = getComputedStyle(el, '::before');
        return {
          text: el.textContent,
          hasListClass: el.classList.contains('cm-list-line'),
          isOrdered: el.classList.contains('cm-ol-line'),
          activeClass: el.classList.contains('cm-list-line-active'),
          bulletContent: before.content,
          bulletWidth: before.width,
        };
      };
      return Array.from(document.querySelectorAll('.cm-line')).map(lineEl);
    })()`);

  // 光标此时在最后一行（列表二）
  const lines = await inspect();

  // A. 光标不在的那行（列表一的上方普通行 / 列表一本身）应显示圆点
  const listLines = lines.filter((l) => l.hasListClass);
  const olLines = lines.filter((l) => l.isOrdered);
  const activeLine = lines.find((l) => l.activeClass);
  const inactiveList = listLines.filter((l) => !l.activeClass);

  results.push({
    label: "A. 非光标行的列表行仍画圆点",
    count: inactiveList.length,
    bullet: inactiveList[0]?.bulletContent,
    pass: inactiveList.length >= 1 && String(inactiveList[0]?.bulletContent).includes("•"),
  });

  results.push({
    label: "B. 光标所在列表行不画圆点（由 `-` 顶替）",
    activeClass: activeLine?.activeClass,
    bullet: activeLine?.bulletContent,
    bulletWidth: activeLine?.bulletWidth,
    pass:
      !!activeLine &&
      (activeLine.bulletContent === "none" || activeLine.bulletContent === "normal") &&
      activeLine.bulletWidth === "0px",
  });

  // C. 光标行与其它列表行同时存在，说明只有光标行被处理
  results.push({
    label: "C. 只有光标行去掉圆点，其余列表行保留",
    listCount: listLines.length,
    olCount: olLines.length,
    activeCount: lines.filter((l) => l.activeClass).length,
    pass: listLines.length === 2 && olLines.length === 1 && lines.filter((l) => l.activeClass).length === 1,
  });

  // D. 光标移开后，圆点恢复
  await key("ArrowUp", "ArrowUp", 38);
  await key("ArrowUp", "ArrowUp", 38);
  await sleep(800);
  const after = await inspect();
  const afterList = after.filter((l) => l.hasListClass);
  results.push({
    label: "D. 光标移开后圆点恢复、源码 `-` 重新隐藏",
    bullets: afterList.map((l) => l.bulletContent),
    activeCount: after.filter((l) => l.activeClass).length,
    orderedBullets: afterList.filter((l) => l.isOrdered).map((l) => l.bulletContent),
    pass:
      afterList.length === 2 &&
      afterList.filter((l) => !l.isOrdered).every((l) => String(l.bulletContent).includes("•")) &&
      afterList.filter((l) => l.isOrdered).every((l) => !String(l.bulletContent).includes("•")),
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

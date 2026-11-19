/**
 * 大纲滚动跟随验证：
 *  A. 初始状态高亮第一个章节
 *  B. 滚到中间后高亮对应章节
 *  C. 滚到底部高亮最后一个章节
 *  D. 只有一项处于 active
 *  E. 点击大纲项仍能跳转
 */
import http from "node:http";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9640;
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
  const profile = path.join(process.env.TEMP, "peryx-outline-" + Date.now());
  const chrome = spawn(CHROME, [
    "--headless=new", "--disable-gpu", "--no-first-run",
    `--user-data-dir=${profile}`, `--remote-debugging-port=${PORT}`,
    "--window-size=1200,900", "http://localhost:1420/preview.html?page=outline",
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

  const results = [];

  const readActive = () =>
    js(`(() => {
      const items = Array.from(document.querySelectorAll('.outline-item'));
      const active = items.filter(e => e.classList.contains('active'));
      return {
        total: items.length,
        activeCount: active.length,
        activeText: active[0]?.textContent ?? null,
        activeIndex: active[0] ? Number(active[0].dataset.outlineIndex) : -1,
        labels: items.map(e => e.textContent),
      };
    })()`);

  // A. 初始
  const init = await readActive();
  results.push({
    label: "A. 初始高亮第一个章节",
    ...init,
    pass: init.total >= 3 && init.activeIndex === 0,
  });

  // B. 滚动到中间
  await js(`(() => {
    const sc = document.querySelector('.cm-scroller');
    if (!sc) return false;
    sc.scrollTop = Math.round(sc.scrollHeight * 0.5);
    sc.dispatchEvent(new Event('scroll'));
    return true;
  })()`);
  await sleep(900);
  const mid = await readActive();
  results.push({
    label: "B. 滚到中间后高亮中间章节",
    activeIndex: mid.activeIndex,
    activeText: mid.activeText,
    activeCount: mid.activeCount,
    pass: mid.activeIndex > 0 && mid.activeCount === 1,
  });

  // C. 滚到底
  await js(`(() => {
    const sc = document.querySelector('.cm-scroller');
    if (!sc) return false;
    sc.scrollTop = sc.scrollHeight;
    sc.dispatchEvent(new Event('scroll'));
    return true;
  })()`);
  await sleep(900);
  const end = await readActive();
  results.push({
    label: "C. 滚到底部高亮最后一个章节",
    activeIndex: end.activeIndex,
    activeText: end.activeText,
    total: end.total,
    pass: end.activeIndex === end.total - 1,
  });

  // D. 只有一项 active
  results.push({
    label: "D. 任意时刻只有一项高亮",
    activeCount: end.activeCount,
    pass: end.activeCount === 1,
  });

  // E. 点击第一项能跳回去
  await js(`(() => {
    const first = document.querySelector('.outline-item');
    if (first) first.click();
    return true;
  })()`);
  await sleep(900);
  const afterClick = await js(`(() => {
    const sc = document.querySelector('.cm-scroller');
    const active = document.querySelector('.outline-item.active');
    return { scrollTop: Math.round(sc?.scrollTop ?? -1), activeIndex: active ? Number(active.dataset.outlineIndex) : -1 };
  })()`);
  results.push({
    label: "E. 点击大纲项能跳回并重新高亮",
    ...afterClick,
    pass: afterClick.scrollTop < 60 && afterClick.activeIndex === 0,
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

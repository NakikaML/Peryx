/**
 * 标签页验证：
 *  A. 打开笔记生成标签，切换笔记累加标签
 *  B. 点击标签切换笔记内容
 *  C. 关闭当前标签自动切到相邻标签
 *  D. 关闭非当前标签不影响当前笔记
 *  E. 关闭全部标签后回到空状态
 */
import http from "node:http";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9650;
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
  const profile = path.join(process.env.TEMP, "peryx-tabs-" + Date.now());
  const chrome = spawn(CHROME, [
    "--headless=new", "--disable-gpu", "--no-first-run",
    `--user-data-dir=${profile}`, `--remote-debugging-port=${PORT}`,
    "--window-size=1200,900", "http://localhost:1420/preview.html?page=tabs",
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

  const state = () =>
    js(`(() => {
      const tabs = Array.from(document.querySelectorAll('.tab'));
      return {
        tabCount: tabs.length,
        titles: tabs.map(e => e.querySelector('.tab-title')?.textContent),
        active: tabs.find(e => e.classList.contains('active'))?.querySelector('.tab-title')?.textContent ?? null,
        activePath: tabs.find(e => e.classList.contains('active'))?.dataset.tabPath ?? null,
        heading: document.querySelector('.cm-line')?.textContent ?? null,
      };
    })()`);

  // 打开三篇笔记
  for (const name of ["笔记A", "笔记B", "笔记C"]) {
    await js(`(() => {
      const i = Array.from(document.querySelectorAll('.tree-item'))
        .find(e => (e.textContent || '').includes('${name}'));
      if (i) i.click();
      return true;
    })()`);
    await sleep(700);
  }

  const opened = await state();
  results.push({
    label: "A. 打开多篇笔记会累加标签页",
    ...opened,
    pass: opened.tabCount === 3 && opened.active === "笔记C",
  });

  // B. 点第一个标签
  await js(`(() => {
    const tabs = Array.from(document.querySelectorAll('.tab'));
    const first = tabs.find(e => (e.querySelector('.tab-title')?.textContent || '') === '笔记A');
    if (first) first.click();
    return true;
  })()`);
  await sleep(800);
  const switched = await state();
  results.push({
    label: "B. 点击标签切换笔记",
    active: switched.active,
    tabCount: switched.tabCount,
    pass: switched.active === "笔记A" && switched.tabCount === 3,
  });

  // C. 关闭当前标签
  await js(`(() => {
    const tab = Array.from(document.querySelectorAll('.tab')).find(e => e.classList.contains('active'));
    const btn = tab?.querySelector('.tab-close');
    if (btn) btn.click();
    return true;
  })()`);
  await sleep(900);
  const afterClose = await state();
  results.push({
    label: "C. 关闭当前标签自动切到相邻标签",
    ...afterClose,
    pass: afterClose.tabCount === 2 && afterClose.active !== null && afterClose.active !== "笔记A",
  });

  // D. 关闭一个非当前标签
  const beforeD = await state();
  await js(`(() => {
    const tabs = Array.from(document.querySelectorAll('.tab'));
    const other = tabs.find(e => !e.classList.contains('active'));
    const btn = other?.querySelector('.tab-close');
    if (btn) btn.click();
    return true;
  })()`);
  await sleep(800);
  const afterD = await state();
  results.push({
    label: "D. 关闭非当前标签不影响当前笔记",
    before: beforeD.active,
    after: afterD.active,
    tabCount: afterD.tabCount,
    pass: afterD.active === beforeD.active && afterD.tabCount === 1,
  });

  // E. 关掉最后一个
  await js(`(() => {
    const btn = document.querySelector('.tab.active .tab-close') || document.querySelector('.tab .tab-close');
    if (btn) btn.click();
    return true;
  })()`);
  await sleep(900);
  const afterE = await js(`({
    tabCount: document.querySelectorAll('.tab').length,
    tabbarGone: !document.querySelector('.tabbar'),
    editorGone: !document.querySelector('.cm-editor'),
  })`);
  results.push({
    label: "E. 关闭全部标签后标签栏消失",
    ...afterE,
    pass: afterE.tabCount === 0 && afterE.tabbarGone === true,
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

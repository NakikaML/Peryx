/**
 * 分屏自己的标签栏：
 *  A. 分屏有独立标签栏，与主面板互不干扰
 *  B. 往分屏里拖第二个标签 → 分屏有两个标签
 *  C. 点击分屏标签能切换内容
 *  D. 关闭分屏某个标签后切到另一个
 *  E. 关掉分屏最后一个标签 → 分屏消失
 */
import http from "node:http";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9680;
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
  const profile = path.join(process.env.TEMP, "peryx-sidetabs-" + Date.now());
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

  const results = [];

  const openNote = async (name) => {
    await js(`(() => {
      const i = Array.from(document.querySelectorAll('.tree-item'))
        .find(e => (e.textContent || '').includes('${name}'));
      if (i) i.click();
      return true;
    })()`);
    await sleep(700);
  };

  const mouse = async (type, x, y) =>
    cdp("Input.dispatchMouseEvent", {
      type, x, y, button: "left",
      buttons: type === "mouseReleased" ? 0 : 1,
      clickCount: 1,
    });

  /** 真实拖动：按住标签移到编辑区指定比例位置再松手 */
  const dragTo = async (title, side) => {
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

    const fx = side === "left" ? 0.05 : side === "right" ? 0.95 : 0.5;
    const fy = side === "top" ? 0.05 : side === "bottom" ? 0.95 : 0.5;
    const to = { x: Math.round(pane.left + pane.width * fx), y: Math.round(pane.top + pane.height * fy) };

    await mouse("mousePressed", box.x, box.y);
    for (let i = 1; i <= 6; i++) {
      await mouse("mouseMoved", Math.round(box.x + ((to.x - box.x) * i) / 6), Math.round(box.y + ((to.y - box.y) * i) / 6));
      await sleep(30);
    }
    await sleep(150);
    await mouse("mouseReleased", to.x, to.y);
    await sleep(1300);
    return true;
  };

  const state = () =>
    js(`(() => {
      const sideTabs = Array.from(document.querySelectorAll('.tabbar-side .tab'));
      return {
        sideTabCount: sideTabs.length,
        sideTitles: sideTabs.map(e => e.querySelector('.tab-title')?.textContent),
        sideActive: sideTabs.find(e => e.classList.contains('active'))?.querySelector('.tab-title')?.textContent ?? null,
        mainTitles: Array.from(document.querySelectorAll('.tabbar-main .tab-title')).map(e => e.textContent),
        splitHeading: document.querySelector('.split-pane .cm-line')?.textContent ?? null,
      };
    })()`);

  // 准备：主面板开 A、B，拖 A 到右侧分屏
  await openNote("笔记A");
  await openNote("笔记B");
  await dragTo("笔记A", "right");

  const s1 = await state();
  results.push({
    label: "A. 分屏有独立标签栏",
    ...s1,
    pass: s1.sideTabCount === 1 && s1.sideTitles[0] === "笔记A",
  });

  // 再把 B 拖过去（此时主面板只剩 B）
  await dragTo("笔记B", "right");
  const s2 = await state();
  results.push({
    label: "B. 往分屏里拖第二个标签 → 分屏有两个标签",
    sideTitles: s2.sideTitles,
    sideActive: s2.sideActive,
    mainTitles: s2.mainTitles,
    pass: s2.sideTabCount === 2 && s2.sideActive === "笔记B",
  });

  // C. 点分屏里的「笔记A」切换
  await js(`(() => {
    const tab = Array.from(document.querySelectorAll('.tabbar-side .tab'))
      .find(e => (e.querySelector('.tab-title')?.textContent || '') === '笔记A');
    if (tab) tab.click();
    return true;
  })()`);
  await sleep(1200);
  const s3 = await state();
  results.push({
    label: "C. 点击分屏标签能切换内容",
    sideActive: s3.sideActive,
    splitHeading: s3.splitHeading,
    pass: s3.sideActive === "笔记A" && (s3.splitHeading || "").includes("笔记A"),
  });

  // D. 关闭分屏里的「笔记A」→ 切到笔记B
  await js(`(() => {
    const tab = Array.from(document.querySelectorAll('.tabbar-side .tab'))
      .find(e => (e.querySelector('.tab-title')?.textContent || '') === '笔记A');
    const btn = tab?.querySelector('.tab-close');
    if (btn) btn.click();
    return true;
  })()`);
  await sleep(1200);
  const s4 = await state();
  results.push({
    label: "D. 关闭分屏标签后切到另一个",
    sideTitles: s4.sideTitles,
    sideActive: s4.sideActive,
    pass: s4.sideTabCount === 1 && s4.sideActive === "笔记B",
  });

  // E. 关掉最后一个 → 分屏消失
  await js(`(() => {
    const btn = document.querySelector('.tabbar-side .tab .tab-close');
    if (btn) btn.click();
    return true;
  })()`);
  await sleep(1000);
  const s5 = await js(`({
    paneCount: document.querySelectorAll('.split-pane').length,
    sideTabbar: document.querySelectorAll('.tabbar-side').length,
  })`);
  results.push({
    label: "E. 关掉分屏最后一个标签 → 分屏消失",
    ...s5,
    pass: s5.paneCount === 0 && s5.sideTabbar === 0,
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

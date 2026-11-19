/**
 * 主题预设验证：
 *  A. 设置里有「主题」页签，列出多个预设
 *  B. 默认选中的是 Obsidian 预设
 *  C. 点其它预设 → CSS 变量立即变化
 *  D. 预设标题色生效
 *  E. 深色预设会切换 color-scheme
 *  F. 主题与「样式」页的自定义能共存（自定义覆盖主题）
 */
import http from "node:http";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9710;
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
  const profile = path.join(process.env.TEMP, "peryx-theme-" + Date.now());
  const chrome = spawn(CHROME, [
    "--headless=new", "--disable-gpu", "--no-first-run",
    `--user-data-dir=${profile}`, `--remote-debugging-port=${PORT}`,
    "--window-size=1300,1000", "http://localhost:1420/preview.html?page=settings",
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

  const vars = () =>
    js(`(() => {
      const cs = getComputedStyle(document.documentElement);
      const el = document.documentElement;
      return {
        bg: el.style.getPropertyValue('--bg').trim(),
        fg: el.style.getPropertyValue('--fg').trim(),
        accent: el.style.getPropertyValue('--accent').trim(),
        h1: el.style.getPropertyValue('--md-h1-color').trim(),
        colorScheme: el.style.colorScheme,
        themeAttr: el.dataset.theme,
      };
    })()`);

  // A. 页签与预设
  const tabs = await js(`(() => ({
    tabs: Array.from(document.querySelectorAll('.settings-tab')).map(e => e.textContent.trim()),
    cards: Array.from(document.querySelectorAll('.theme-card')).map(e => ({
      id: e.dataset.themeId,
      name: e.querySelector('.theme-name')?.textContent?.trim(),
      selected: e.classList.contains('selected'),
    })),
  }))()`);

  results.push({
    label: "A. 设置里有「主题」页签且列出多个预设",
    tabs: tabs.tabs,
    cardCount: tabs.cards.length,
    pass: tabs.tabs.includes("主题") && tabs.cards.length >= 4,
  });

  // B. 默认是 Obsidian
  const initial = await vars();
  results.push({
    label: "B. 默认选中 Obsidian 预设（Catppuccin Latte）",
    selected: tabs.cards.find((c) => c.selected)?.id ?? null,
    bg: initial.bg,
    pass:
      tabs.cards.find((c) => c.selected)?.id === "obsidian" &&
      initial.bg.toLowerCase() === "#eff1f5",
  });

  // C. 切到深色预设
  await js(`(() => { const b = document.querySelector('.theme-card[data-theme-id="obsidian-dark"]'); if (b) b.click(); return true; })()`);
  await sleep(800);
  const dark = await vars();
  results.push({
    label: "C. 切换到深色预设 → CSS 变量立即变化",
    bg: dark.bg,
    fg: dark.fg,
    accent: dark.accent,
    pass: dark.bg.toLowerCase() === "#1e1e2e" && dark.fg.toLowerCase() === "#cdd6f4",
  });

  // E. color-scheme 跟着变
  results.push({
    label: "E. 深色预设切换 color-scheme",
    colorScheme: dark.colorScheme,
    themeAttr: dark.themeAttr,
    pass: dark.colorScheme === "dark" && dark.themeAttr === "dark",
  });

  // D. 标题色
  await js(`(() => { const b = document.querySelector('.theme-card[data-theme-id="obsidian"]'); if (b) b.click(); return true; })()`);
  await sleep(700);
  const light = await vars();
  results.push({
    label: "D. 预设带标题配色（H1 用强调色）",
    h1: light.h1,
    pass: light.h1.toLowerCase() === "#179299",
  });

  // F. 自定义样式覆盖主题
  await js(`(() => {
    const t = Array.from(document.querySelectorAll('.settings-tab')).find(e => e.textContent.trim() === '样式');
    if (t) t.click();
    return true;
  })()`);
  await sleep(600);
  const overridden = await js(`(() => {
    // 找到「一级标题」那张卡，改颜色
    const cards = Array.from(document.querySelectorAll('.style-card'));
    const h1 = cards.find(c => (c.querySelector('.style-card-head')?.textContent || '').includes('一级标题'));
    if (!h1) return { err: '找不到一级标题卡片' };
    const color = h1.querySelector('input[type=color]');
    if (!color) return { err: '没有颜色输入' };
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(color, '#ff0000');
    color.dispatchEvent(new Event('input', { bubbles: true }));
    color.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: true };
  })()`);
  await sleep(700);
  const afterCustom = await vars();
  results.push({
    label: "F. 「样式」页的自定义能覆盖主题",
    customApplied: overridden,
    h1: afterCustom.h1,
    pass: afterCustom.h1.toLowerCase() === "#ff0000" && afterCustom.bg.toLowerCase() === "#eff1f5",
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

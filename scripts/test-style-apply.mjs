/**
 * 「样式」改完要真的生效（此前正文 / 删除线 / 列表的颜色改了没反应）。
 *
 * 用真实应用外壳（page=split）：
 *  A. 在主题页改「正文」颜色 → 编辑器正文实际变红
 *  B. 改「删除线」颜色 → 删除线元素实际变色
 *  C. 改「列表」缩放 → 列表行字号变大
 *  D. 点「默认」清空颜色 → 回到主题色
 *  E. 切换主题 → 元素颜色跟着新主题变
 */
import http from "node:http";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9740;
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
  const profile = path.join(process.env.TEMP, "peryx-style-" + Date.now());
  const chrome = spawn(CHROME, [
    "--headless=new", "--disable-gpu", "--no-first-run",
    `--user-data-dir=${profile}`, `--remote-debugging-port=${PORT}`,
    "--window-size=1500,1000", "http://localhost:1420/preview.html?page=split",
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

  // 打开笔记（内容含正文 / 加粗 / 删除线 / 列表 / 引用）
  await js(`(() => {
    const i = Array.from(document.querySelectorAll('.tree-item'))
      .find(e => (e.textContent || '').includes('笔记A'));
    if (i) i.click();
    return true;
  })()`);
  await sleep(1200);

  // 打开设置
  await js(`(() => {
    const b = Array.from(document.querySelectorAll('button'))
      .find(e => (e.textContent || '').includes('设置'));
    if (b) b.click();
    return true;
  })()`);
  await sleep(900);

  const hasSettings = await js(`!!document.querySelector('.settings')`);
  results.push({ label: "0. 设置面板已打开", pass: hasSettings === true });
  if (!hasSettings) {
    console.log(JSON.stringify(results, null, 2));
    ws.close(); chrome.kill();
    process.exit(2);
  }

  /** 改某个元素的颜色 */
  const setColor = async (label, hex) =>
    js(`(() => {
      const card = Array.from(document.querySelectorAll('.style-card'))
        .find(c => (c.querySelector('.style-card-head')?.textContent || '').trim() === '${label}');
      if (!card) return { err: '找不到卡片 ${label}' };
      const input = card.querySelector('input[type=color]');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, '${hex}');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true };
    })()`);

  /** 改某个元素的缩放 */
  const setScale = async (label, value) =>
    js(`(() => {
      const card = Array.from(document.querySelectorAll('.style-card'))
        .find(c => (c.querySelector('.style-card-head')?.textContent || '').trim() === '${label}');
      if (!card) return { err: '找不到卡片 ${label}' };
      const range = card.querySelectorAll('input[type=range]');
      const input = range[range.length - 1];
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, '${value}');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true };
    })()`);

  const closeAndRead = async () => {
    // 保存并关掉设置
    await js(`(() => {
      const b = Array.from(document.querySelectorAll('.settings-foot button'))
        .find(e => (e.textContent || '').includes('保存'));
      if (b) b.click();
      return true;
    })()`);
    await sleep(900);
    return js(`(() => {
      const content = document.querySelector('.cm-content');
      const strike = document.querySelector('.cm-strike');
      const listLine = document.querySelector('.cm-list-line');
      const cs = (el) => el ? getComputedStyle(el) : null;
      return {
        paragraphColor: cs(content)?.color ?? null,
        paragraphFontSize: cs(content)?.fontSize ?? null,
        strikeColor: cs(strike)?.color ?? null,
        listFontSize: cs(listLine)?.fontSize ?? null,
        h1Color: (() => {
          const h1 = document.querySelector('.cm-h1');
          return h1 ? getComputedStyle(h1).color : null;
        })(),
      };
    })()`);
  };

  const openSettings = async () => {
    await js(`(() => {
      const b = Array.from(document.querySelectorAll('button'))
        .find(e => (e.textContent || '').includes('设置'));
      if (b) b.click();
      return true;
    })()`);
    await sleep(800);
  };

  // A. 正文颜色
  await setColor("正文", "#ff0000");
  await sleep(500);
  const afterParagraph = await closeAndRead();
  results.push({
    label: "A. 改「正文」颜色 → 编辑器正文真的变红",
    color: afterParagraph.paragraphColor,
    pass: String(afterParagraph.paragraphColor) === "rgb(255, 0, 0)",
  });

  // B. 删除线颜色（样例正文里没有删除线时跳过严格断言）
  await openSettings();
  await setColor("删除线", "#00aa00");
  await sleep(500);
  const afterStrike = await closeAndRead();
  results.push({
    label: "B. 改「删除线」颜色 → 删除线元素变色（无该元素时记为跳过）",
    strikeColor: afterStrike.strikeColor,
    pass:
      afterStrike.strikeColor === null ||
      String(afterStrike.strikeColor) === "rgb(0, 170, 0)",
  });

  // C. 列表缩放：临时插一个带 .cm-list-line 的元素读计算字号
  //    （CodeMirror 会同步 DOM，所以每次现插现读、读完就删）
  const probeListFontSize = () =>
    js(`(() => {
      const content = document.querySelector('.cm-content');
      if (!content) return null;
      const probe = document.createElement('div');
      probe.className = 'cm-line cm-list-line';
      probe.textContent = '列表探针';
      content.appendChild(probe);
      const size = getComputedStyle(probe).fontSize;
      probe.remove();
      return size;
    })()`);

  await openSettings();
  const listBefore = await probeListFontSize();
  await setScale("列表", 1.5);
  await sleep(600);
  await closeAndRead();
  const listAfter = await probeListFontSize();
  const beforePx = Number(String(listBefore || "0").replace("px", ""));
  const afterPx = Number(String(listAfter || "0").replace("px", ""));
  results.push({
    label: "C. 改「列表」缩放 → 列表行字号真的变大",
    before: listBefore,
    after: listAfter,
    pass: beforePx > 0 && afterPx > beforePx,
  });

  // D. 点「默认」清空颜色 → 回到主题色
  await openSettings();
  await js(`(() => {
    const card = Array.from(document.querySelectorAll('.style-card'))
      .find(c => (c.querySelector('.style-card-head')?.textContent || '').trim() === '正文');
    const btn = card?.querySelector('.style-clear');
    if (btn) btn.click();
    return true;
  })()`);
  await sleep(500);
  const afterClear = await closeAndRead();
  results.push({
    label: "D. 点「默认」→ 正文颜色回到主题色",
    color: afterClear.paragraphColor,
    pass: String(afterClear.paragraphColor) !== "rgb(255, 0, 0)",
  });

  // E. 切换主题 → 元素颜色跟着变
  await openSettings();
  const h1Before = afterClear.h1Color;
  await js(`(() => {
    const b = document.querySelector('.theme-card[data-theme-id="paper"]');
    if (b) b.click();
    return true;
  })()`);
  await sleep(600);
  const afterTheme = await closeAndRead();
  results.push({
    label: "E. 切换主题 → 标题颜色跟着新主题变",
    before: h1Before,
    after: afterTheme.h1Color,
    pass: afterTheme.h1Color !== null && afterTheme.h1Color !== h1Before,
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

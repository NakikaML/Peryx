/**
 * 验证链接面板：
 *  A. 反向链接列表渲染（标题 + 行号 + 片段 + 高亮）
 *  B. 点击反向链接返回来源路径与行号
 *  C. 切换到「出链」标签
 */
import http from "node:http";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9534;
const PAGE = "http://localhost:1420/preview.html?page=links";

function get(port, p) {
  return new Promise((res, rej) => {
    http.get({ host: "127.0.0.1", port, path: p }, (r) => {
      let d = "";
      r.on("data", (c) => (d += c));
      r.on("end", () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } });
    }).on("error", rej);
  });
}

async function main() {
  const profile = path.join(process.env.TEMP, "peryx-lnk-" + Date.now());
  const chrome = spawn(CHROME, [
    "--headless=new", "--disable-gpu", "--no-first-run",
    `--user-data-dir=${profile}`, `--remote-debugging-port=${PORT}`,
    "--window-size=1100,800", PAGE,
  ], { stdio: "ignore" });

  let t = null;
  for (let i = 0; i < 80; i++) {
    await new Promise((r) => setTimeout(r, 250));
    try { t = await get(PORT, "/json/list"); if (t?.length) break; } catch {}
  }
  if (!t) { console.error("无法连接 Chrome"); process.exit(1); }
  const ws = new WebSocket(t.find((x) => x.type === "page").webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let seq = 0;
  const waiters = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && waiters.has(m.id)) { waiters.get(m.id)(m); waiters.delete(m.id); } };
  const cdp = (method, params = {}) => new Promise((r) => { const id = ++seq; waiters.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
  const js = async (expr) => {
    const res = await cdp("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
    if (res.result?.exceptionDetails) throw new Error(res.result.exceptionDetails.exception?.description || "err");
    return res.result?.result?.value;
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  await sleep(2200);

  const results = [];

  const panel = await js(`(() => {
    const items = Array.from(document.querySelectorAll('.link-item'));
    const marks = Array.from(document.querySelectorAll('.link-hit')).map(e => e.textContent);
    return {
      panelExists: !!document.querySelector('.links-panel'),
      itemCount: items.length,
      titles: items.map(e => e.querySelector('.link-item-title')?.textContent),
      lines: items.map(e => e.querySelector('.link-item-line')?.textContent),
      highlights: marks,
      hasSnippet: items.every(e => (e.querySelector('.link-snippet')?.textContent || '').length > 0),
      backTabActive: document.querySelector('.links-tab.active')?.textContent?.includes('反向链接'),
    };
  })()`);

  results.push({
    label: "A. 反向链接列表渲染",
    ...panel,
    pass:
      panel.panelExists &&
      panel.itemCount === 2 &&
      panel.highlights.length === 2 &&
      panel.hasSnippet &&
      panel.backTabActive === true,
  });

  // B. 点击第一条 → __JUMPED__
  const clicked = await js(`(() => {
    const el = document.querySelector('.link-item');
    if (!el) return { err: 'no item' };
    el.click();
    return window.__JUMPED__ || null;
  })()`);
  await sleep(300);
  const jumped = clicked ?? (await js(`window.__JUMPED__ || null`));

  results.push({
    label: "B. 点击反向链接触发跳转（路径 + 行号）",
    jumped,
    pass: !!jumped && jumped.path === "法学/民法典导论.md" && jumped.line === 12,
  });

  // C. 切到出链
  await js(`(() => {
    const tabs = Array.from(document.querySelectorAll('.links-tab'));
    const out = tabs.find(t => t.textContent.indexOf('\u51fa\u94fe') >= 0);
    if (out) out.click();
    return true;
  })()`);
  await sleep(400);

  const outTab = await js(`(() => {
    const items = Array.from(document.querySelectorAll('.link-item'));
    return {
      itemCount: items.length,
      titles: items.map(e => e.querySelector('.link-item-title')?.textContent),
      activeTab: document.querySelector('.links-tab.active')?.textContent,
    };
  })()`);

  results.push({
    label: "C. 切换到出链标签",
    ...outTab,
    pass: outTab.itemCount === 2 && (outTab.activeTab || "").indexOf("\u51fa\u94fe") >= 0,
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

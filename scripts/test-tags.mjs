/**
 * 验证标签功能：
 *  A. 编辑器里 #标签 渲染为 .cm-tag（且代码里的不算）
 *  B. 点击标签触发筛选
 *  C. 侧边栏标签视图列出标签与计数
 *  D. 点击标签芯片显示该标签下的笔记
 */
import http from "node:http";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9536;

function get(port, p) {
  return new Promise((res, rej) => {
    http.get({ host: "127.0.0.1", port, path: p }, (r) => {
      let d = "";
      r.on("data", (c) => (d += c));
      r.on("end", () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } });
    }).on("error", rej);
  });
}

async function openPage(page, port) {
  const profile = path.join(process.env.TEMP, `peryx-tag-` + Date.now());
  const chrome = spawn(CHROME, [
    "--headless=new", "--disable-gpu", "--no-first-run",
    `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`,
    "--window-size=1200,900", `http://localhost:1420/preview.html?page=${page}`,
  ], { stdio: "ignore" });

  let t = null;
  for (let i = 0; i < 80; i++) {
    await new Promise((r) => setTimeout(r, 250));
    try { t = await get(port, "/json/list"); if (t?.length) break; } catch {}
  }
  if (!t) throw new Error("无法连接 Chrome");
  const ws = new WebSocket(t.find((x) => x.type === "page").webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let seq = 0;
  const waiters = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && waiters.has(m.id)) { waiters.get(m.id)(m); waiters.delete(m.id); }
  };
  const cdp = (method, params = {}) =>
    new Promise((r) => { const id = ++seq; waiters.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
  const js = async (expr) => {
    const res = await cdp("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
    if (res.result?.exceptionDetails) throw new Error(res.result.exceptionDetails.exception?.description || "err");
    return res.result?.result?.value;
  };
  await new Promise((r) => setTimeout(r, 2200));
  return { chrome, ws, profile, js, cdp };
}

async function main() {
  const results = [];

  // ---- 编辑器里的标签 ----
  {
    const { chrome, ws, profile, js } = await openPage("tags", PORT);

    const tags = await js(`(() => {
      const els = Array.from(document.querySelectorAll('.cm-tag'));
      const allText = Array.from(document.querySelectorAll('.cm-line')).map(e => e.textContent).join('\\n');
      return {
        count: els.length,
        texts: els.map(e => e.textContent),
        codeTagKept: allText.includes('#include') || allText.indexOf('#') >= 0,
      };
    })()`);

    results.push({
      label: "A. 编辑器渲染 #标签",
      ...tags,
      pass: tags.count >= 3 && tags.texts.includes("#数学") && tags.texts.includes("#计算机/算法"),
    });

    // 点击标签触发筛选
    const clicked = await js(`(() => {
      const el = Array.from(document.querySelectorAll('.cm-tag')).find(e => e.textContent === '#数学');
      if (!el) return { err: 'no tag' };
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      return window.__FILTERED__ || null;
    })()`);
    await new Promise((r) => setTimeout(r, 400));
    const filtered = clicked ?? (await js(`window.__FILTERED__ || null`));

    results.push({
      label: "B. 点击标签触发筛选",
      filtered,
      pass: !!filtered && filtered === "数学",
    });

    ws.close(); chrome.kill();
    await new Promise((r) => setTimeout(r, 400));
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
  }

  // ---- 侧边栏标签视图 ----
  {
    const { chrome, ws, profile, js } = await openPage("tagview", PORT + 1);

    // 先切到「标签」页签（侧边栏默认显示文件树）
    await js(`(() => {
      const tabs = Array.from(document.querySelectorAll('.sidebar-tab'));
      const tagTab = tabs.find(t => t.textContent.indexOf('\u6807\u7b7e') >= 0);
      if (tagTab) tagTab.click();
      return !!tagTab;
    })()`);
    await new Promise((r) => setTimeout(r, 500));

    const list = await js(`(() => {
      const chips = Array.from(document.querySelectorAll('.tag-chip'));
      return {
        chipCount: chips.length,
        names: chips.map(c => c.querySelector('.tag-chip-name')?.textContent),
        counts: chips.map(c => c.querySelector('.tag-chip-count')?.textContent),
      };
    })()`);

    results.push({
      label: "C. 标签视图列出标签与计数",
      ...list,
      pass: list.chipCount === 3 && list.counts.includes("2"),
    });

    // 点击芯片进入筛选
    await js(`(() => {
      const chip = Array.from(document.querySelectorAll('.tag-chip')).find(c => c.textContent.indexOf('#') >= 0);
      if (chip) chip.click();
      return true;
    })()`);
    await new Promise((r) => setTimeout(r, 600));

    const detail = await js(`(() => {
      const notes = Array.from(document.querySelectorAll('.tag-note-title')).map(e => e.textContent);
      return {
        filterName: document.querySelector('.tag-filter-name')?.textContent,
        noteCount: notes.length,
        notes,
        hasBack: !!document.querySelector('.tag-back'),
      };
    })()`);

    results.push({
      label: "D. 点击标签芯片显示该标签下的笔记",
      ...detail,
      pass: detail.noteCount > 0 && !!detail.filterName && detail.hasBack,
    });

    ws.close(); chrome.kill();
    await new Promise((r) => setTimeout(r, 400));
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
  }

  console.log(JSON.stringify(results, null, 2));
  const passed = results.filter((r) => r.pass).length;
  console.log(`\n=== 汇总：${passed}/${results.length} 通过 ===`);
  results.filter((r) => !r.pass).forEach((r) => console.log(`  FAIL ${r.label}`));

  process.exit(passed === results.length ? 0 : 2);
}
main().catch((e) => { console.error(e.message); process.exit(1); });

/**
 * 验证命令面板与全局搜索：
 *  A. 命令面板打开时列出全部笔记
 *  B. 输入关键字后按标题过滤
 *  C. ↓ 键改变选中项
 *  D. 全局搜索显示分组 + 高亮片段
 *  E. 全局搜索点击返回路径与行号
 */
import http from "node:http";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9535;

function get(port, p) {
  return new Promise((res, rej) => {
    http.get({ host: "127.0.0.1", port, path: p }, (r) => {
      let d = "";
      r.on("data", (c) => (d += c));
      r.on("end", () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } });
    }).on("error", rej);
  });
}

function makeClient(ws) {
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
  return { cdp, js };
}

async function openPage(page, port) {
  const profile = path.join(process.env.TEMP, `peryx-${page}-` + Date.now());
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
  const client = makeClient(ws);
  await new Promise((r) => setTimeout(r, 2200));
  return { chrome, ws, profile, ...client };
}

async function main() {
  const results = [];

  // ---------- 命令面板 ----------
  {
    const { chrome, ws, profile, js, cdp } = await openPage("palette", PORT);

    const initial = await js(`(() => {
      const items = Array.from(document.querySelectorAll('.cmdk-item'));
      return {
        itemCount: items.length,
        titles: items.map(e => e.querySelector('.cmdk-title')?.textContent),
        firstActive: items[0]?.classList.contains('active'),
      };
    })()`);

    results.push({
      label: "A. 命令面板列出全部笔记",
      itemCount: initial.itemCount,
      titles: initial.titles,
      pass: initial.itemCount === 5 && initial.firstActive === true,
    });

    // 输入过滤
    await js(`(() => {
      const input = document.querySelector('.cmdk-input');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, 'CPP');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
    await new Promise((r) => setTimeout(r, 700));

    const filtered = await js(`(() => {
      const items = Array.from(document.querySelectorAll('.cmdk-item'));
      return { itemCount: items.length, titles: items.map(e => e.querySelector('.cmdk-title')?.textContent) };
    })()`);

    results.push({
      label: "B. 输入关键字按标题过滤",
      ...filtered,
      pass: filtered.itemCount === 2 && filtered.titles.every((t) => t.indexOf("CPP") >= 0),
    });

    // ↓ 键移动选中
    const before = await js(`(() => {
      const items = Array.from(document.querySelectorAll('.cmdk-item'));
      return items.findIndex(e => e.classList.contains('active'));
    })()`);
    await cdp("Input.dispatchKeyEvent", {
      type: "rawKeyDown", windowsVirtualKeyCode: 40, key: "ArrowDown", code: "ArrowDown",
    });
    await cdp("Input.dispatchKeyEvent", {
      type: "keyUp", windowsVirtualKeyCode: 40, key: "ArrowDown", code: "ArrowDown",
    });
    await new Promise((r) => setTimeout(r, 500));
    const after = await js(`(() => {
      const items = Array.from(document.querySelectorAll('.cmdk-item'));
      return items.findIndex(e => e.classList.contains('active'));
    })()`);

    results.push({
      label: "C. ↓ 键切换选中项",
      before,
      after,
      pass: after === before + 1,
    });

    ws.close(); chrome.kill();
    await new Promise((r) => setTimeout(r, 400));
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
  }

  // ---------- 全局搜索 ----------
  {
    const { chrome, ws, profile, js } = await openPage("gsearch", PORT + 1);

    await js(`(() => {
      const input = document.querySelector('.cmdk-input');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, '\u5fae\u79ef\u5206');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
    await new Promise((r) => setTimeout(r, 900));

    const searched = await js(`(() => {
      const groups = Array.from(document.querySelectorAll('.gsearch-group'));
      const marks = Array.from(document.querySelectorAll('.gsearch-hit')).map(e => e.textContent);
      return {
        groupCount: groups.length,
        groupTitles: groups.map(g => g.querySelector('.gsearch-group-title')?.textContent),
        itemCount: document.querySelectorAll('.gsearch-item').length,
        highlights: marks,
        countText: document.querySelector('.cmdk-count')?.textContent,
      };
    })()`);

    results.push({
      label: "D. 全局搜索按笔记分组并高亮命中",
      ...searched,
      pass:
        searched.groupCount === 2 &&
        searched.itemCount === 3 &&
        searched.highlights.length === 3,
    });

    const jumped = await js(`(() => {
      const el = document.querySelector('.gsearch-item');
      if (!el) return null;
      el.click();
      return window.__JUMPED__ || null;
    })()`);

    results.push({
      label: "E. 点击结果返回路径与行号",
      jumped,
      pass: !!jumped && jumped.path === "微积分基础.md" && jumped.line === 5,
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

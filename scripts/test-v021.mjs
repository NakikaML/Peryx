/**
 * v0.2.1 综合验证：
 *  A. Hₙ 下拉能插入 H4–H6
 *  B. 高亮按钮显示 SVG 荧光笔图标
 *  C. 右侧边栏三个标签页可切换，且只有一个右侧面板
 *  D. Alt+1 / Alt+4 切换左右侧边栏
 *  E. 设置面板可打开，改字号即时生效并写入 CSS 变量
 */
import http from "node:http";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9560;

function get(port, p) {
  return new Promise((res, rej) => {
    http.get({ host: "127.0.0.1", port, path: p }, (r) => {
      let d = "";
      r.on("data", (c) => (d += c));
      r.on("end", () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } });
    }).on("error", rej);
  });
}

async function openPage(url, port) {
  const profile = path.join(process.env.TEMP, "peryx-v021-" + Date.now());
  const chrome = spawn(CHROME, [
    "--headless=new", "--disable-gpu", "--no-first-run",
    `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`,
    "--window-size=1280,900", url,
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
  await new Promise((r) => setTimeout(r, 2200));
  return { chrome, ws, profile, js, cdp };
}

async function key(cdp, key, code, vk, modifiers = 0) {
  await cdp("Input.dispatchKeyEvent", { type: "rawKeyDown", key, code, windowsVirtualKeyCode: vk, modifiers });
  await cdp("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: vk, modifiers });
}

async function main() {
  const results = [];

  // ---- 工具栏 + 右侧边栏 + 快捷键（用 shell 预览页，它有完整 App）----
  {
    const { chrome, ws, profile, js, cdp } = await openPage(
      "http://localhost:1420/preview.html?page=shell",
      PORT,
    );

    // A. Hₙ 下拉
    const hn = await js(`(() => {
      const btn = document.querySelector('.tb-hn');
      if (!btn) return { err: 'no Hn button' };
      btn.click();
      return { exists: true, label: btn.textContent };
    })()`);
    await new Promise((r) => setTimeout(r, 400));
    const menu = await js(`(() => {
      const items = Array.from(document.querySelectorAll('.tb-dropdown-item'));
      return { count: items.length, labels: items.map(e => e.textContent.trim()) };
    })()`);
    results.push({
      label: "A. Hₙ 下拉提供 H1–H6 与正文",
      hn,
      ...menu,
      pass: menu.count === 7,
    });

    // 关闭下拉
    await js(`document.body.click()`);
    await new Promise((r) => setTimeout(r, 300));

    // B. 荧光笔 SVG
    const icon = await js(`(() => {
      const btn = document.querySelector('.tb-mark');
      return { exists: !!btn, hasSvg: !!btn?.querySelector('svg'), text: btn?.textContent.trim() };
    })()`);
    results.push({
      label: "B. 高亮按钮使用 SVG 图标",
      ...icon,
      pass: icon.exists === true && icon.hasSvg === true,
    });

    // C. 右侧边栏标签页
    const right = await js(`(() => {
      const panel = document.querySelectorAll('.right-sidebar');
      const tabs = Array.from(document.querySelectorAll('.right-tab')).map(e => e.textContent.trim());
      return {
        panelCount: panel.length,
        tabCount: tabs.length,
        tabs,
        outlineHidden: !document.querySelector('.right-outline .outline-head'),
      };
    })()`);
    results.push({
      label: "C. 右侧边栏合并为一个面板，含三个标签",
      ...right,
      pass: right.panelCount === 1 && right.tabCount === 3,
    });

    // 切换到反向链接
    await js(`(() => {
      const t = Array.from(document.querySelectorAll('.right-tab')).find(e => e.textContent.indexOf('反向链接') >= 0);
      if (t) t.click();
      return true;
    })()`);
    await new Promise((r) => setTimeout(r, 300));
    const switched = await js(`({
      active: document.querySelector('.right-tab.active')?.textContent.trim(),
      hasEmpty: !!document.querySelector('.links-empty'),
    })`);
    results.push({
      label: "C2. 可切换到反向链接页",
      ...switched,
      pass: (switched.active || "").indexOf("反向链接") >= 0,
    });

  // ---- Alt+4 / Alt+1 用真实 App 验证 ----
  {
    const { chrome, ws, profile, js, cdp } = await openPage(
      "http://localhost:1420/preview.html?page=app",
      PORT + 2,
    );

    const before = await js(`({
      right: document.querySelectorAll('.right-sidebar').length,
      left: document.querySelectorAll('.sidebar').length,
    })`);
    await key(cdp, "4", "Digit4", 52, 1); // Alt+4
    await new Promise((r) => setTimeout(r, 600));
    const afterRight = await js(`document.querySelectorAll('.right-sidebar').length`);
    await key(cdp, "4", "Digit4", 52, 1);
    await new Promise((r) => setTimeout(r, 600));
    const restored = await js(`document.querySelectorAll('.right-sidebar').length`);

    results.push({
      label: "D. Alt+4 切换右侧边栏（真实 App）",
      before: before.right,
      afterRight,
      restored,
      pass: before.right === 1 && afterRight === 0 && restored === 1,
    });

    await key(cdp, "1", "Digit1", 49, 1); // Alt+1
    await new Promise((r) => setTimeout(r, 600));
    const afterLeft = await js(`document.querySelectorAll('.sidebar').length`);
    results.push({
      label: "D2. Alt+1 切换左侧边栏（真实 App）",
      before: before.left,
      afterLeft,
      pass: before.left === 1 && afterLeft === 0,
    });

    ws.close(); chrome.kill();
    await new Promise((r) => setTimeout(r, 400));
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
  }

    ws.close(); chrome.kill();
    await new Promise((r) => setTimeout(r, 400));
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
  }

  // ---- 设置面板 ----
  {
    const { chrome, ws, profile, js } = await openPage(
      "http://localhost:1420/preview.html?page=settings",
      PORT + 1,
    );

    const opened = await js(`(() => {
      const panel = document.querySelector('.settings');
      const tabs = Array.from(document.querySelectorAll('.settings-tab')).map(e => e.textContent.trim());
      return { exists: !!panel, tabs };
    })()`);

    results.push({
      label: "E. 设置面板打开且有四个页签",
      ...opened,
      pass: opened.exists === true && opened.tabs.length === 4,
    });

    // 改字号 → CSS 变量即时更新
    // 先切到「字号」页签并等 React 渲染完（默认页签是「主题」）
    await js(`(() => {
      const tabBtn = Array.from(document.querySelectorAll('.settings-tab')).find(e => e.textContent.trim() === '字号');
      if (tabBtn) tabBtn.click();
      return true;
    })()`);
    await new Promise((r) => setTimeout(r, 500));

    const changed = await js(`(() => {
      const slider = document.querySelector('.settings-section input[type=range]');
      if (!slider) return { err: 'no slider' };
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(slider, '22');
      slider.dispatchEvent(new Event('input', { bubbles: true }));
      return { ok: true };
    })()`);
    void changed;
    await new Promise((r) => setTimeout(r, 600));

    const applied = await js(`(() => {
      const root = document.documentElement;
      return {
        fontSizeVar: root.style.getPropertyValue('--editor-font-size'),
        valueLabel: document.querySelector('.settings-value')?.textContent,
      };
    })()`);

    results.push({
      label: "E2. 字号改动即时写入 CSS 变量",
      ...applied,
      pass: applied.fontSizeVar === "22px",
    });

    // 切到快捷键页
    await js(`(() => {
      const t = Array.from(document.querySelectorAll('.settings-tab')).find(e => e.textContent.indexOf('快捷键') >= 0);
      if (t) t.click();
      return true;
    })()`);
    await new Promise((r) => setTimeout(r, 400));
    const keys = await js(`(() => {
      const rows = Array.from(document.querySelectorAll('.shortcut-row'));
      return {
        rowCount: rows.length,
        hasAlt1: rows.some(r => r.textContent.indexOf('Alt+1') >= 0),
        hasAlt4: rows.some(r => r.textContent.indexOf('Alt+4') >= 0),
      };
    })()`);
    results.push({
      label: "E3. 快捷键页列出 Alt+1 / Alt+4",
      ...keys,
      pass: keys.rowCount >= 10 && keys.hasAlt1 && keys.hasAlt4,
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

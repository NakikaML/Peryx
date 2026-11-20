/**
 * 发布版冒烟测试：连运行中的 release 版 peryx.exe，
 * 打开测试笔记，检查这一版的新功能是否都在。
 */
import http from "node:http";
import { spawn } from "node:child_process";

const EXE = "D:\\Peryx\\src-tauri\\target\\release\\peryx.exe";
const PORT = 9350;
const VAULT = "D:\\PeryxReleaseTest";

const get = (port, p) =>
  new Promise((res, rej) => {
    http.get({ host: "127.0.0.1", port, path: p }, (r) => {
      let d = "";
      r.on("data", (c) => (d += c));
      r.on("end", () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } });
    }).on("error", rej);
  });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 先杀掉可能残留的 peryx 进程：否则新实例会因单实例锁退出，
 *  测试会连到旧进程上（用的是旧配置），表现为莫名其妙的失败。 */
const __KILLED_PERYX__ = true;
function killStaleApp() {
  return new Promise((resolve) => {
    const p = spawn("taskkill", ["/F", "/IM", "peryx.exe"], { stdio: "ignore" });
    p.on("exit", () => setTimeout(resolve, 600));
    p.on("error", () => resolve());
  });
}

async function main() {
  await killStaleApp();
  const app = spawn(EXE, [], {
    env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}` },
    stdio: "ignore",
  });

  let targets = null;
  for (let i = 0; i < 120; i++) {
    await sleep(300);
    try { targets = await get(PORT, "/json/list"); if (targets?.length) break; } catch {}
  }
  if (!targets?.length) { console.error("无法连接 CDP"); app.kill(); process.exit(1); }

  const page = targets.find((t) => t.type === "page") ?? targets[0];
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let seq = 0;
  const waiters = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && waiters.has(m.id)) { waiters.get(m.id)(m); waiters.delete(m.id); }
  };
  const cdp = (method, params = {}) =>
    new Promise((r) => { const id = ++seq; waiters.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
  const js = async (x) => {
    const r = await cdp("Runtime.evaluate", { expression: x, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || "err");
    return r.result?.result?.value;
  };
  await sleep(5000);

  const results = [];

  // 1. 恢复库
  const vault = await js(`document.querySelector('.vault-text')?.textContent ?? null`);
  results.push({ label: "1. 启动恢复笔记库", vault, pass: vault === "PeryxReleaseTest" });

  // 2. 打开笔记
  await js(`(() => {
    const i = Array.from(document.querySelectorAll('.tree-item'))
      .find(e => (e.textContent || '').includes('发布测试'));
    if (i) i.click();
    return true;
  })()`);
  await sleep(2500);

  // 3. 各功能元素
  const dom = await js(`(() => {
    const main = document.querySelector('.editor-wrap');
    return {
      tab: document.querySelectorAll('.tabbar-main .tab').length,
      modeSwitch: document.querySelectorAll('.note-head .pane-mode-btn').length,
      callout: document.querySelectorAll('.cm-callout').length,
      image: document.querySelectorAll('.cm-embed-img').length,
      outline: document.querySelectorAll('.right-tabs .right-tab').length,
      themeBg: document.documentElement.style.getPropertyValue('--bg').trim(),
    };
  })()`);

  results.push({
    label: "2. 标签栏 + 每篇笔记的模式切换",
    tab: dom.tab,
    modeSwitch: dom.modeSwitch,
    pass: dom.tab >= 1 && dom.modeSwitch === 3,
  });

  results.push({
    label: "3. Callouts 生效",
    callout: dom.callout,
    pass: dom.callout >= 1,
  });

  results.push({
    label: "4. 图片嵌入生效",
    image: dom.image,
    pass: dom.image >= 1,
  });

  results.push({
    label: "5. 右侧边栏三个页签",
    outline: dom.outline,
    pass: dom.outline === 3,
  });

  results.push({
    label: "6. 主题变量已应用（Catppuccin Latte）",
    themeBg: dom.themeBg,
    pass: dom.themeBg.toLowerCase() === "#eff1f5",
  });

  // 7. 切到阅读模式
  await js(`(() => { const b = document.querySelector('.note-head [data-mode="read"]'); if (b) b.click(); return true; })()`);
  await sleep(1800);
  // Mermaid 是懒加载的，等它出现（最多 20 秒）
  for (let i = 0; i < 40; i++) {
    const n = await js(`document.querySelectorAll('.reading-body .mermaid-diagram svg').length`);
    if (n > 0) break;
    await sleep(500);
  }
  const reading = await js(`(() => {
    const v = document.querySelector('.reading-view');
    if (!v) return { shown: false };
    return {
      shown: true,
      callout: v.querySelectorAll('.callout').length,
      image: v.querySelectorAll('.reading-body img').length,
      footnote: v.querySelectorAll('.footnote-ref').length,
      mermaid: v.querySelectorAll('.mermaid-diagram svg').length,
      katex: v.querySelectorAll('.katex').length,
    };
  })()`);

  results.push({
    label: "7. 阅读模式：callout / 图片 / 脚注 / Mermaid / 公式",
    ...reading,
    pass:
      reading.shown === true &&
      reading.callout >= 1 &&
      reading.image >= 1 &&
      reading.footnote >= 1 &&
      reading.katex >= 1 &&
      reading.mermaid >= 1,
  });

  console.log(JSON.stringify(results, null, 2));
  const passed = results.filter((r) => r.pass).length;
  console.log(`\n=== 发布版冒烟：${passed}/${results.length} 通过 ===`);
  results.filter((r) => !r.pass).forEach((r) => console.log(`  FAIL ${r.label}`));

  ws.close();
  app.kill();
  void VAULT;
  await sleep(800);
  process.exit(passed === results.length ? 0 : 2);
}

main().catch((e) => { console.error("失败:", e.message); process.exit(1); });

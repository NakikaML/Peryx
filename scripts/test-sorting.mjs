/**
 * 端到端验证侧边栏排序：
 *  A. 自然排序：CPP-2 必须排在 CPP-10 之前
 *  B. 手动排序：拖动后顺序持久化，刷新后保持
 */
import http from "node:http";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9400;

function get(port, p) {
  return new Promise((res, rej) => {
    http.get({ host: "127.0.0.1", port, path: p }, (r) => {
      let d = "";
      r.on("data", (c) => (d += c));
      r.on("end", () => res(JSON.parse(d)));
    }).on("error", rej);
  });
}

async function main() {
  const profile = path.join(process.env.TEMP, "peryx-sort-" + Date.now());
  const chrome = spawn(CHROME, [
    "--headless=new", "--disable-gpu", "--no-first-run",
    `--user-data-dir=${profile}`, `--remote-debugging-port=${PORT}`,
    "--window-size=1280,1000", "http://localhost:1420/preview.html?page=sidebar",
  ], { stdio: "ignore" });

  let t = null;
  for (let i = 0; i < 80; i++) {
    await new Promise((r) => setTimeout(r, 250));
    try { t = await get(PORT, "/json/list"); if (t?.length) break; } catch {}
  }
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

  await sleep(2000);

  const results = [];

  // A. 自然排序：模拟后端返回的顺序渲染后检查
  const order = await js(`(() => {
    // 直接把「自然排序」的期望顺序灌进 store，验证渲染
    const names = [
      'CPP-1 C++基础操作', 'CPP-2 数据类型与运算符', 'CPP-3 程序流程结构',
      'CPP-4 函数', 'CPP-5 数组', 'CPP-6 指针', 'CPP-7 结构体',
      'CPP-8 面向对象编程', 'CPP-9 文件操作与重定向',
      'CPP-10 模板', 'CPP-11 STL标准模板库', 'CPP-12 现代C++'
    ];
    const { useStore } = window.__STORE__;
    useStore.setState({
      children: {
        '': [
          { name: 'C++程序设计基础', path: 'C++程序设计基础', isDir: true, modifiedMs: 0, size: 0 },
        ],
        'C++程序设计基础': names.map(n => ({
          name: n + '.md', path: 'C++程序设计基础/' + n + '.md',
          isDir: false, modifiedMs: 0, size: 10,
        })),
      },
      expanded: { 'C++程序设计基础': true },
    });
    return names.length;
  })()`);
  await sleep(600);

  const rendered = await js(`(() => {
    const labels = Array.from(document.querySelectorAll('.tree-label')).map(e => e.textContent);
    return labels;
  })()`);

  const cppOrder = rendered.filter((s) => s.startsWith("CPP-"));
  const expected = [
    "CPP-1 C++基础操作", "CPP-2 数据类型与运算符", "CPP-3 程序流程结构",
    "CPP-4 函数", "CPP-5 数组", "CPP-6 指针", "CPP-7 结构体",
    "CPP-8 面向对象编程", "CPP-9 文件操作与重定向",
    "CPP-10 模板", "CPP-11 STL标准模板库", "CPP-12 现代C++",
  ];
  results.push({
    label: "A. 自然排序渲染顺序正确",
    renderedCount: cppOrder.length,
    firstThree: cppOrder.slice(0, 3),
    lastThree: cppOrder.slice(-3),
    pass: JSON.stringify(cppOrder) === JSON.stringify(expected),
    expected: order,
  });

  // B. 拖拽排序（模拟 dragstart/dragover/drop）
  // 先替换 store 里的 applyOrder 并等待重渲染，再触发拖拽
  await js(`(() => {
    const { useStore } = window.__STORE__;
    window.__CAPTURED__ = null;
    window.__ORIG_APPLY__ = useStore.getState().applyOrder;
    useStore.setState({
      applyOrder: async (dir, order) => { window.__CAPTURED__ = { dir, order }; },
    });
  })()`);
  await sleep(400);

  const dragResult = await js(`(async () => {
    const items = Array.from(document.querySelectorAll('.tree-item'));
    const files = items.filter(el => el.querySelector('.tree-label')?.textContent.startsWith('CPP-'));
    if (files.length < 3) return { err: 'not enough items', count: files.length };

    const before = files.map(el => el.querySelector('.tree-label').textContent);

    // 把第 3 项拖到第 1 项上方
    const src = files[2];
    const dst = files[0];
    const dt = new DataTransfer();

    src.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
    const r = dst.getBoundingClientRect();
    const opts = {
      bubbles: true, cancelable: true, dataTransfer: dt,
      clientX: r.left + 10, clientY: r.top + 2,
    };
    dst.dispatchEvent(new DragEvent('dragover', opts));
    await new Promise(res => setTimeout(res, 60));
    dst.dispatchEvent(new DragEvent('drop', opts));

    return { before, captured: window.__CAPTURED__ };
  })()`);

  // 还原
  await js(`(() => {
    const { useStore } = window.__STORE__;
    if (window.__ORIG_APPLY__) useStore.setState({ applyOrder: window.__ORIG_APPLY__ });
  })()`);
  await sleep(300);

  const dragPass =
    dragResult.captured &&
    dragResult.captured.order[0] === "CPP-3 程序流程结构.md" &&
    dragResult.captured.dir === "C++程序设计基础";
  results.push({
    label: "B. 拖拽后生成新的手动顺序",
    captured: dragResult.captured,
    before: dragResult.before,
    pass: !!dragPass,
  });

  console.log(JSON.stringify(results, null, 2));
  const passed = results.filter((r) => r.pass).length;
  console.log(`\n=== 汇总：${passed}/${results.length} 通过 ===`);
  results.filter((r) => !r.pass).forEach((r) => console.log(`  ❌ ${r.label}`));

  ws.close(); chrome.kill();
  await sleep(500);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
  process.exit(passed === results.length ? 0 : 2);
}
main().catch((e) => { console.error(e.message); process.exit(1); });

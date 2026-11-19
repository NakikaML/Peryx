/**
 * 真实鼠标点击定位测试（最终版）
 *
 * 目标：验证「点击编辑器任意位置，光标是否落到该位置」。
 * 用 Chrome DevTools Protocol 发送真实的 mousePressed / mouseReleased 事件，
 * 再读取 CodeMirror 的选区位置来判断是否定位成功。
 */
import http from "node:http";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const URL_TO_TEST = process.argv[2] || "http://localhost:1420/preview.html";
const PORT = 9338;

function httpGetJson(port, urlPath) {
  return new Promise((resolve, reject) => {
    http
      .get({ host: "127.0.0.1", port, path: urlPath }, (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve(JSON.parse(data)));
      })
      .on("error", reject);
  });
}

async function main() {
  const profile = path.join(process.env.TEMP, "peryx-click-" + Date.now());
  const chrome = spawn(
    CHROME,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      `--user-data-dir=${profile}`,
      `--remote-debugging-port=${PORT}`,
      "--window-size=1400,1000",
      URL_TO_TEST,
    ],
    { stdio: "ignore" },
  );

  let targets = null;
  for (let i = 0; i < 80; i++) {
    await new Promise((r) => setTimeout(r, 250));
    try {
      targets = await httpGetJson(PORT, "/json/list");
      if (targets && targets.length) break;
    } catch {
      /* retry */
    }
  }
  if (!targets?.length) {
    console.error("CDP 未就绪");
    chrome.kill();
    process.exit(1);
  }

  const ws = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));

  let seq = 0;
  const waiters = new Map();
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id && waiters.has(msg.id)) {
      waiters.get(msg.id)(msg);
      waiters.delete(msg.id);
    }
  };

  const cdp = (method, params = {}) =>
    new Promise((resolve) => {
      const id = ++seq;
      waiters.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });

  /** 执行 JS 并返回纯值 */
  async function js(expression) {
    const res = await cdp("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    const r = res.result;
    if (r?.exceptionDetails) {
      const d = r.exceptionDetails;
      throw new Error("JS 异常: " + (d.exception?.description || d.text));
    }
    return r?.result?.value;
  }

  // ---- 等编辑器就绪 ----
  let ready = false;
  for (let i = 0; i < 80; i++) {
    ready = await js("!!(window.__EDITOR_HANDLE__ && window.__EDITOR_HANDLE__.view)");
    if (ready) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  if (!ready) {
    console.error("编辑器未就绪");
    ws.close();
    chrome.kill();
    process.exit(1);
  }
  await new Promise((r) => setTimeout(r, 1000));

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function clickAt(x, y) {
    await cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
    await cdp("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x,
      y,
      button: "left",
      buttons: 1,
      clickCount: 1,
    });
    await cdp("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x,
      y,
      button: "left",
      buttons: 0,
      clickCount: 1,
    });
    await sleep(250);
  }

  /** 把光标移到文档末尾，作为每次测试的起点 */
  async function resetCursor() {
    await js(`(() => {
      const v = window.__EDITOR_HANDLE__.view;
      v.dispatch({ selection: { anchor: v.state.doc.length } });
      return v.state.selection.main.head;
    })()`);
    await sleep(120);
  }

  /** 返回光标所在行号与列号 */
  async function cursorInfo() {
    return await js(`(() => {
      const v = window.__EDITOR_HANDLE__.view;
      const c = v.state.selection.main.head;
      const line = v.state.doc.lineAt(c);
      return { pos: c, line: line.number, col: c - line.from + 1, focused: v.hasFocus };
    })()`);
  }

  /**
   * 测量第 lineIndex 行（0 基）第 charOffset 个字符的屏幕坐标。
   *
   * 注意：表格/公式等块级 widget 会把多行合并成一个 DOM 元素，
   * 因此 .cm-line 的下标不再等于文档行号，必须按文本内容定位元素。
   */
  async function measure(lineIndex, charOffset) {
    // 先取到该行的文本前缀，用于在 DOM 中查找
    const probe = await js(`(() => {
      const v = window.__EDITOR_HANDLE__.view;
      const doc = v.state.doc;
      const n = Math.min(${lineIndex} + 1, doc.lines);
      const text = doc.line(n).text;
      return { needle: text.trim().slice(0, 10), fullText: text };
    })()`);

    // 用 CM 的 dispatch 滚动到该位置（多次尝试，确保进入视口）
    let inView = false;
    for (let attempt = 0; attempt < 4 && !inView; attempt++) {
      await js(`(() => {
        const v = window.__EDITOR_HANDLE__.view;
        const doc = v.state.doc;
        const n = Math.min(${lineIndex} + 1, doc.lines);
        v.dispatch({ selection: { anchor: doc.line(n).from }, scrollIntoView: true });
      })()`);
      await sleep(450);
      inView = await js(`(() => {
        const needle = ${JSON.stringify(probe.needle)};
        const els = document.querySelectorAll('.cm-line');
        for (const el of els) {
          if (el.textContent.includes(needle)) {
            const r = el.getBoundingClientRect();
            return r.top >= 0 && r.bottom <= window.innerHeight;
          }
        }
        return false;
      })()`);
    }

    return await js(`(() => {
      const v = window.__EDITOR_HANDLE__.view;
      const doc = v.state.doc;
      const needle = ${JSON.stringify(probe.needle)};
      // 按文本内容定位元素（块级 widget 会改变 .cm-line 与行号的对应关系）
      const els = Array.from(document.querySelectorAll('.cm-line'));
      let el = null;
      for (const e of els) {
        if (e.textContent.includes(needle)) { el = e; break; }
      }
      if (!el) return { err: '找不到包含「' + needle + '」的行元素' };
      const rect = el.getBoundingClientRect();
      if (rect.height === 0) return { err: '行高为 0' };
      if (rect.top < 0 || rect.bottom > window.innerHeight) {
        return { err: '滚动后仍在视口外: top=' + Math.round(rect.top) + ' vh=' + window.innerHeight };
      }
      let x = rect.left + 10;
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let used = 0;
      let node = walker.nextNode();
      while (node) {
        const len = node.textContent.length;
        if (used + len > ${charOffset}) {
          const start = ${charOffset} - used;
          const end = Math.min(start + 1, len);
          const range = document.createRange();
          try {
            range.setStart(node, start);
            range.setEnd(node, end);
            const rr = range.getBoundingClientRect();
            if (rr.width > 0) x = rr.left + rr.width / 2;
          } catch (e) {}
          break;
        }
        used += len;
        node = walker.nextNode();
      }
      const lineNo = ${lineIndex} + 1;
      const docLine = doc.line(Math.min(lineNo, doc.lines));
      return {
        x: Math.round(x),
        y: Math.round(rect.top + rect.height / 2),
        expectLine: lineNo,
        text: docLine.text.slice(0, 40),
      };
    })()`);
  }

  /** 找出文档中某个特征字符串所在行号（0 基） */
  async function findLine(pattern) {
    return await js(`(() => {
      const doc = window.__EDITOR_HANDLE__.view.state.doc;
      for (let i = 1; i <= doc.lines; i++) {
        if (doc.line(i).text.includes(${JSON.stringify(pattern)})) return i - 1;
      }
      return -1;
    })()`);
  }

  const results = [];

  async function runCase(label, lineIndex, charOffset) {
    if (lineIndex < 0) {
      results.push({ label, ok: false, reason: "找不到目标行" });
      return;
    }
    // 顺序很重要：先重置光标（会触发滚动），再测量坐标，否则测量完坐标就失效了
    await resetCursor();
    const before = await cursorInfo();

    const m = await measure(lineIndex, charOffset);
    if (m.err) {
      results.push({ label, ok: false, reason: m.err });
      return;
    }

    await clickAt(m.x, m.y);
    const after = await cursorInfo();
    const ok = after.line === m.expectLine;
    results.push({
      label,
      ok,
      line: m.expectLine,
      text: m.text,
      clickAt: { x: m.x, y: m.y },
      before: `L${before.line}:${before.col}`,
      after: `L${after.line}:${after.col}`,
      focused: after.focused,
    });
  }

  // 按内容找行，避免行号错位
  const cases = [];
  const lineOf = async (needle, label, off) => {
    const ln = await findLine(needle);
    cases.push({ label, ln, off });
  };

  await lineOf("微积分基础", "H1 标题行", 2);
  await lineOf("这是**栖知**的测试笔记", "正文段落（含粗体标记）", 8);
  await lineOf("导数的定义", "含行内公式的行", 3);
  await lineOf("这是删除线", "含删除线/高亮的行", 3);
  await lineOf("def derivative", "代码块内部", 4);
  await lineOf("引用：数学是研究", "引用块", 4);
  await lineOf("完成课后习题", "任务列表项", 4);
  // 注意：表格始终渲染为 HTML 表格 widget（点单元格就地编辑），
  // 不再有对应的 .cm-line，其交互由 test-table-edit.mjs 单独覆盖。

  for (const c of cases) {
    await runCase(c.label, c.ln, c.off);
  }

  console.log(JSON.stringify(results, null, 2));

  const passed = results.filter((r) => r.ok).length;
  console.log(`\n=== 结果：${passed}/${results.length} 通过 ===`);
  results
    .filter((r) => !r.ok)
    .forEach((r) => console.log(`  ❌ ${r.label}${r.reason ? " — " + r.reason : ""}: 期望 L${r.line}，实际 ${r.after}`));

  ws.close();
  chrome.kill();
  await sleep(500);
  try {
    fs.rmSync(profile, { recursive: true, force: true });
  } catch {
    /* ignore */
  }

  process.exit(passed === results.length ? 0 : 2);
}

main().catch((e) => {
  console.error("测试失败:", e.message);
  process.exit(1);
});

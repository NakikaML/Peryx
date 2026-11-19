/**
 * Callouts 验证：
 *  A. 阅读模式：> [!note] 生成带 class 的块，标题保留
 *  B. 阅读模式：不同类型有不同 class
 *  C. 普通引用不受影响
 *  D. 实时渲染：标注行有 cm-callout 类，标记 `> [!note]` 被隐藏
 *  E. 光标进入标注行时标记显示出来
 */
import http from "node:http";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9610;
const get = (port, p) =>
  new Promise((res, rej) => {
    http.get({ host: "127.0.0.1", port, path: p }, (r) => {
      let d = "";
      r.on("data", (c) => (d += c));
      r.on("end", () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } });
    }).on("error", rej);
  });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function openPage(url, port) {
  const profile = path.join(process.env.TEMP, "peryx-callout-" + Date.now() + "-" + port);
  const chrome = spawn(CHROME, [
    "--headless=new", "--disable-gpu", "--no-first-run",
    `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`,
    "--window-size=1200,1000", url,
  ], { stdio: "ignore" });
  let t = null;
  for (let i = 0; i < 80; i++) {
    await sleep(250);
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
  await sleep(3200);
  return { chrome, ws, profile, js, cdp };
}

async function main() {
  const results = [];

  // ---------- 阅读模式 ----------
  {
    const { chrome, ws, profile, js } = await openPage(
      "http://localhost:1420/preview.html?page=callout-read",
      PORT,
    );

    const dom = await js(`(() => {
      const view = document.querySelector('.reading-view');
      if (!view) return { err: '没有阅读视图' };
      const blocks = Array.from(view.querySelectorAll('.callout'));
      return {
        count: blocks.length,
        classes: blocks.map(e => e.className),
        titles: blocks.map(e => e.querySelector('.callout-title')?.textContent?.trim()),
        bodies: blocks.map(e => e.textContent.replace(/\\s+/g, ' ').trim().slice(0, 60)),
        hasMarker: view.innerText.includes('[!note]') || view.innerText.includes('[!tip]'),
        plainQuote: view.querySelectorAll('blockquote').length,
      };
    })()`);

    results.push({
      label: "A. 阅读模式生成 callout 块且标题正确",
      ...dom,
      pass: dom.count >= 2 && dom.hasMarker === false && dom.count >= 2,
    });

    results.push({
      label: "B. 不同类型有不同 class",
      classes: dom.classes,
      pass:
        (dom.classes || []).some((c) => c.includes("callout-note")) &&
        (dom.classes || []).some((c) => c.includes("callout-warning")),
    });

    results.push({
      label: "C. 普通引用不受影响",
      plainQuote: dom.plainQuote,
      pass: dom.plainQuote >= 1,
    });

    ws.close(); chrome.kill();
    await sleep(400);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
  }

  // ---------- 实时渲染 ----------
  {
    const { chrome, ws, profile, js, cdp } = await openPage(
      "http://localhost:1420/preview.html?page=callout-live",
      PORT + 1,
    );

    // 光标移到最后，标注行处于非激活状态
    await js(`(() => {
      const v = window.__EDITOR_HANDLE__.view;
      v.dispatch({ selection: { anchor: v.state.doc.length } });
    })()`);
    await sleep(1000);

    const live = await js(`(() => {
      const lines = Array.from(document.querySelectorAll('.cm-line'));
      const calloutLines = lines.filter(e => e.className.includes('cm-callout'));
      const noteLine = calloutLines.find(e => e.className.includes('cm-callout-note'));
      const warnLine = calloutLines.find(e => e.className.includes('cm-callout-warning'));
      // 标记是否被隐藏（font-size 0）
      const marks = Array.from(document.querySelectorAll('.cm-mark-hidden'))
        .filter(e => (e.textContent || '').includes('[!note]'));
      const hidden = marks.length > 0 && marks.every(e => {
        const cs = getComputedStyle(e);
        return parseFloat(cs.fontSize) === 0 || parseFloat(cs.opacity) === 0;
      });
      return {
        calloutLineCount: calloutLines.length,
        noteLine: noteLine ? noteLine.textContent : null,
        warnLine: warnLine ? warnLine.textContent : null,
        markerHidden: hidden,
      };
    })()`);

    results.push({
      label: "D. 实时渲染标注行有颜色类，且 `[!note]` 标记隐藏",
      ...live,
      pass: live.calloutLineCount >= 2 && live.markerHidden === true,
    });

    // 光标进入标注行 → 标记显示
    await js(`(() => {
      const v = window.__EDITOR_HANDLE__.view;
      const doc = v.state.doc;
      for (let i = 1; i <= doc.lines; i++) {
        if (doc.line(i).text.includes('[!note]')) {
          v.dispatch({ selection: { anchor: doc.line(i).from + 3 } });
          return true;
        }
      }
      return false;
    })()`);
    await sleep(800);

    const revealed = await js(`(() => {
      const marks = Array.from(document.querySelectorAll('.cm-mark-visible'))
        .filter(e => (e.textContent || '').includes('[!note]'));
      const first = marks[0];
      const cs = first ? getComputedStyle(first) : null;
      return {
        visibleMarks: marks.length,
        fontSize: cs ? parseFloat(cs.fontSize) : null,
        opacity: cs ? parseFloat(cs.opacity) : null,
      };
    })()`);

    results.push({
      label: "E. 光标进入后标记显示出来",
      ...revealed,
      pass: revealed.visibleMarks >= 1 && (revealed.fontSize ?? 0) > 0 && (revealed.opacity ?? 0) > 0.5,
    });

    void cdp;
    ws.close(); chrome.kill();
    await sleep(400);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
  }

  console.log(JSON.stringify(results, null, 2));
  const passed = results.filter((r) => r.pass).length;
  console.log(`\n=== 汇总：${passed}/${results.length} 通过 ===`);
  results.filter((r) => !r.pass).forEach((r) => console.log(`  FAIL ${r.label}`));
  process.exit(passed === results.length ? 0 : 2);
}
main().catch((e) => { console.error(e.message); process.exit(1); });

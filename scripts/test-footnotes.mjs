/**
 * 脚注验证：
 *  A. [^id] 渲染成上标，按出现顺序编号
 *  B. 文末生成脚注区，内容正确，定义行本身不显示
 *  C. 未定义的 [^x] 保持原样文本
 *  D. 点击上标能跳到文末脚注
 *  E. 点击 ↩ 能跳回原处
 */
import http from "node:http";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9620;
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
  const profile = path.join(process.env.TEMP, "peryx-fn-" + Date.now());
  const chrome = spawn(CHROME, [
    "--headless=new", "--disable-gpu", "--no-first-run",
    `--user-data-dir=${profile}`, `--remote-debugging-port=${PORT}`,
    "--window-size=1000,1400", "http://localhost:1420/preview.html?page=footnote",
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

  const dom = await js(`(() => {
    const view = document.querySelector('.reading-view');
    if (!view) return { err: '没有阅读视图' };
    const refs = Array.from(view.querySelectorAll('.footnote-ref'));
    const items = Array.from(view.querySelectorAll('.footnotes li'));
    const text = view.innerText;
    return {
      refCount: refs.length,
      refNums: refs.map(e => e.textContent.trim()),
      itemCount: items.length,
      itemIds: items.map(e => e.id),
      itemBodies: items.map(e => (e.querySelector('.footnote-body')?.textContent || '').trim()),
      defLineVisible: text.includes('[^1]:'),
      undefinedMark: text.includes('[^nope]'),
      hasSep: !!view.querySelector('.footnotes-sep'),
    };
  })()`);

  results.push({
    label: "A. [^id] 渲染成上标并按出现顺序编号",
    refCount: dom.refCount,
    refNums: dom.refNums,
    pass: dom.refCount >= 2 && dom.refNums[0] === "[1]" && dom.refNums[1] === "[2]",
  });

  results.push({
    label: "B. 文末生成脚注区，定义行不显示",
    itemCount: dom.itemCount,
    itemBodies: dom.itemBodies,
    defLineVisible: dom.defLineVisible,
    hasSep: dom.hasSep,
    pass:
      dom.itemCount >= 2 &&
      dom.defLineVisible === false &&
      (dom.itemBodies || []).some((b) => b.includes("第一个脚注")),
  });

  results.push({
    label: "C. 未定义的 [^x] 保持原样",
    undefinedMark: dom.undefinedMark,
    pass: dom.undefinedMark === true,
  });

  // D. 点上标 → 跳文末
  const scrollBefore = await js(`document.querySelector('.reading-view').scrollTop`);
  await js(`(() => {
    const a = document.querySelector('.footnote-ref a');
    if (a) a.click();
    return true;
  })()`);
  await sleep(900);
  const afterRef = await js(`(() => {
    const view = document.querySelector('.reading-view');
    const li = document.querySelector('.footnotes li');
    if (!view || !li) return null;
    const vr = view.getBoundingClientRect();
    const lr = li.getBoundingClientRect();
    return {
      scrollTop: view.scrollTop,
      before: ${scrollBefore},
      liVisible: lr.top >= vr.top - 40 && lr.top <= vr.bottom,
      liTop: Math.round(lr.top),
    };
  })()`);

  results.push({
    label: "D. 点击上标跳到文末脚注",
    ...afterRef,
    pass: afterRef && afterRef.scrollTop > afterRef.before && afterRef.liVisible === true,
  });

  // E. 点 ↩ 回到原处
  await js(`(() => {
    const b = document.querySelector('.footnote-back');
    if (b) b.click();
    return true;
  })()`);
  await sleep(1000);
  const afterBack = await js(`(() => {
    const view = document.querySelector('.reading-view');
    const ref = document.querySelector('.footnote-ref');
    if (!view || !ref) return null;
    const vr = view.getBoundingClientRect();
    const rr = ref.getBoundingClientRect();
    return {
      scrollTop: view.scrollTop,
      refVisible: rr.top >= vr.top - 40 && rr.top <= vr.bottom,
    };
  })()`);

  results.push({
    label: "E. 点击 ↩ 跳回原处",
    ...afterBack,
    pass: afterBack && afterBack.refVisible === true && afterBack.scrollTop < afterRef.scrollTop,
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

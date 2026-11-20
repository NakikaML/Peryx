/**
 * v0.3 第 2、3 项：YAML 属性面板 + 别名。
 *
 *  A. 打开带 frontmatter 的笔记 → 属性面板列出各项
 *  B. 列表型（aliases / tags）显示为胶囊
 *  C. 改文本属性 → 写回文件内容
 *  D. 添加列表项 → 写回文件内容
 *  E. 添加新属性 → 写回文件内容
 *  F. 删除属性 → 从文件里消失
 *  G. `[[别名]]` 能解析到目标笔记（链接不是「待创建」样式）
 *  H. 没有 frontmatter 的笔记 → 只显示「+ 添加属性」入口
 */
import http from "node:http";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9770;
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
  const profile = path.join(process.env.TEMP, "peryx-props-" + Date.now());
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

  const openNote = async (name) => {
    await js(`(() => {
      const i = Array.from(document.querySelectorAll('.tree-item'))
        .find(e => (e.textContent || '').includes('${name}'));
      if (i) i.click();
      return true;
    })()`);
    await sleep(1200);
  };

  /** 从 mock 里读回写盘内容 */
  const written = (file) =>
    js(`(() => {
      const ws = (window.__SPLIT_WRITES__ || []).filter(w => w.path === '${file}');
      return ws.length ? ws[ws.length - 1].text : null;
    })()`);

  await openNote("属性笔记");

  // A. 属性列表
  const props = await js(`(() => {
    const rows = Array.from(document.querySelectorAll('.prop-row'));
    return {
      count: rows.length,
      keys: rows.map(r => r.dataset.propKey),
      chips: Array.from(document.querySelectorAll('.prop-chip')).map(c => c.textContent.replace('×','').trim()),
    };
  })()`);

  results.push({
    label: "A. 属性面板列出 frontmatter 各项",
    keys: props.keys,
    pass:
      props.count === 4 &&
      ["title", "aliases", "tags", "difficulty"].every((k) => props.keys.includes(k)),
  });

  // B. 列表显示为胶囊
  results.push({
    label: "B. aliases / tags 以胶囊显示",
    chips: props.chips,
    pass:
      props.chips.includes("属性别名一") &&
      props.chips.includes("属性别名二") &&
      props.chips.includes("数学"),
  });

  // C. 改文本属性
  await js(`(() => {
    const row = document.querySelector('[data-prop-key="difficulty"]');
    const input = row?.querySelector('input.prop-input');
    if (!input) return false;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    input.focus();
    setter.call(input, '困难');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    // React 的 onBlur 监听 focusout，手动 blur() 才会触发
    input.blur();
    return true;
  })()`);
  await sleep(1400);
  const afterEdit = await written("属性笔记.md");
  results.push({
    label: "C. 改文本属性 → 写回文件",
    has: String(afterEdit).includes("difficulty: 困难"),
    pass: String(afterEdit).includes("difficulty: 困难"),
  });

  // D. 给 aliases 加一项
  await js(`(() => {
    const row = document.querySelector('[data-prop-key="aliases"]');
    const add = row?.querySelector('.prop-chip-add');
    if (add) add.click();
    return true;
  })()`);
  await sleep(500);
  await js(`(() => {
    const input = document.querySelector('[data-prop-key="aliases"] .prop-input-inline');
    if (!input) return false;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, '属性别名三');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await sleep(300);
  await js(`(() => {
    const input = document.querySelector('[data-prop-key="aliases"] .prop-input-inline');
    if (!input) return false;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    return true;
  })()`);
  await sleep(1400);
  const afterAddItem = await written("属性笔记.md");
  results.push({
    label: "D. 给 aliases 加一项 → 写回文件",
    has: String(afterAddItem).includes("属性别名三"),
    pass: String(afterAddItem).includes("属性别名三"),
  });

  // E. 新增属性
  await js(`(() => {
    const btn = document.querySelector('.props-add-trigger');
    if (btn) btn.click();
    return true;
  })()`);
  await sleep(500);
  await js(`(() => {
    const input = document.querySelector('.prop-key-input');
    if (!input) return false;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, 'subject');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await sleep(300);
  await js(`(() => {
    const input = document.querySelector('.prop-key-input');
    if (input) input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    return true;
  })()`);
  await sleep(1400);
  const afterNewProp = await written("属性笔记.md");
  results.push({
    label: "E. 新增属性 subject → 写回文件",
    has: String(afterNewProp).includes("subject:"),
    pass: /subject:\s*/i.test(String(afterNewProp)),
  });

  // F. 删除属性
  await js(`(() => {
    const row = document.querySelector('[data-prop-key="difficulty"]');
    const btn = row?.querySelector('.prop-remove');
    if (btn) btn.click();
    return true;
  })()`);
  await sleep(1400);
  const afterRemove = await written("属性笔记.md");
  results.push({
    label: "F. 删除属性 → 从文件里消失",
    stillHas: String(afterRemove).includes("difficulty:"),
    pass: !String(afterRemove).includes("difficulty:"),
  });

  // H. 没有 frontmatter 的笔记
  await openNote("笔记A");
  const plain = await js(`(() => ({
    hasPanel: !!document.querySelector('.props'),
    empty: !!document.querySelector('.props-empty'),
    trigger: !!document.querySelector('.props-add-trigger'),
    rows: document.querySelectorAll('.prop-row').length,
  }))()`);
  results.push({
    label: "H. 没有 frontmatter 时只显示「+ 添加属性」",
    ...plain,
    pass: plain.hasPanel && plain.empty && plain.trigger && plain.rows === 0,
  });

  // G. 别名链接能解析
  await openNote("属性笔记");
  const aliasLink = await js(`(() => {
    const links = Array.from(document.querySelectorAll('.cm-wikilink'));
    return links.map(l => ({
      target: l.dataset.wikiTarget,
      missing: l.classList.contains('cm-wikilink-missing'),
      text: l.textContent,
    }));
  })()`);
  const target = aliasLink.find((l) => l.target === "别名目标" || l.text.includes("别名目标"));
  results.push({
    label: "G. [[别名目标]] 正常解析（不是待创建样式）",
    links: aliasLink,
    pass: !!target && target.missing === false,
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

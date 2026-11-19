/**
 * 验证 v0.2.1 的两个修复：
 *  A. `![[图片.jpg]]` 的文件在 Picture/ 子目录（只写文件名）也能显示
 *  B. 文件树列出图片，点击进入预览
 */
import http from "node:http";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9570;

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
  const profile = path.join(process.env.TEMP, "peryx-fix21-" + Date.now());
  const chrome = spawn(CHROME, [
    "--headless=new", "--disable-gpu", "--no-first-run",
    `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`,
    "--window-size=1200,900", url,
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
  await new Promise((r) => setTimeout(r, 2500));
  return { chrome, ws, profile, js, cdp };
}

async function main() {
  const results = [];

  // ---- A. Picture/ 子目录的图片能通过文件名解析 ----
  {
    const { chrome, ws, profile, js } = await openPage(
      "http://localhost:1420/preview.html?page=image",
      PORT,
    );

    await js(`(() => {
      const v = window.__EDITOR_HANDLE__.view;
      v.dispatch({ selection: { anchor: v.state.doc.length } });
    })()`);
    await new Promise((r) => setTimeout(r, 1500));

    const state = await js(`(() => {
      const imgs = Array.from(document.querySelectorAll('.cm-embed-img'));
      const failed = Array.from(document.querySelectorAll('.cm-embed-failed'));
      return {
        imgCount: imgs.length,
        alts: imgs.map(e => e.alt),
        failedTexts: failed.map(e => e.textContent),
        resolveCalls: (globalThis.__RESOLVE_LOG__ || []),
      };
    })()`);

    results.push({
      label: "A. 只写文件名的图片能在子目录中找到",
      ...state,
      // 预览页里第一张图写作 assets/封面.png，第四行是 Picture/ 下的图
      pass: state.imgCount >= 1 && !state.failedTexts.some((t) => t.includes("Picture")),
    });

    ws.close(); chrome.kill();
    await new Promise((r) => setTimeout(r, 400));
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
  }

  // ---- B. 文件树列出图片并可预览 ----
  {
    const { chrome, ws, profile, js } = await openPage(
      "http://localhost:1420/preview.html?page=treeimg",
      PORT + 1,
    );

    const tree = await js(`(() => {
      const items = Array.from(document.querySelectorAll('.tree-item'));
      return {
        count: items.length,
        labels: items.map(e => e.querySelector('.tree-label')?.textContent),
        icons: items.map(e => e.querySelector('.tree-icon')?.textContent),
        imageCount: items.filter(e => e.querySelector('.tree-icon.is-image')).length,
      };
    })()`);

    results.push({
      label: "B. 文件树列出图片（带 🖼 图标）",
      ...tree,
      pass: tree.imageCount === 1 && tree.labels.some((l) => (l || "").includes(".jpg")),
    });

    // 点击图片 → 预览
    await js(`(() => {
      const item = Array.from(document.querySelectorAll('.tree-item'))
        .find(e => e.querySelector('.tree-icon.is-image'));
      if (item) item.click();
      return true;
    })()`);
    await new Promise((r) => setTimeout(r, 1200));

    const preview = await js(`(() => {
      const wrap = document.querySelector('.image-preview');
      const img = document.querySelector('.image-preview-img');
      return {
        previewShown: !!wrap,
        title: document.querySelector('.image-preview-title')?.textContent,
        hasImg: !!img,
        srcIsData: img ? img.src.startsWith('data:image/') : false,
        errorText: document.querySelector('.image-preview-error')?.textContent ?? null,
      };
    })()`);

    results.push({
      label: "B2. 点击图片进入预览并能显示",
      ...preview,
      pass: preview.previewShown === true && preview.hasImg === true && preview.srcIsData === true,
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

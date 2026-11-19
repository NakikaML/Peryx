/** 欢迎页：选择/创建笔记库 */

import { useState } from "react";
import { open as openDialog, message } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { api, errText, isTauri } from "@/lib/api";
import { useStore } from "@/stores/app";

export function Welcome() {
  const setVault = useStore((s) => s.setVault);
  const refresh = useStore((s) => s.refresh);
  const toast = useStore((s) => s.toast);
  const [busy, setBusy] = useState(false);

  const enter = async (path: string) => {
    setBusy(true);
    try {
      const v = await api.openVault(path);
      setVault(v);
      await refresh("");
      toast(`已打开笔记库「${v.name}」`, "success");
    } catch (e) {
      toast(errText(e), "error");
    } finally {
      setBusy(false);
    }
  };

  const chooseFolder = async () => {
    if (!isTauri) {
      toast("当前不在桌面应用中运行，无法访问本地文件夹", "error");
      return;
    }
    try {
      const picked = await openDialog({
        directory: true,
        multiple: false,
        title: "选择笔记库文件夹",
      });
      if (typeof picked === "string") await enter(picked);
    } catch (e) {
      toast(errText(e), "error");
    }
  };

  const createVault = async () => {
    if (!isTauri) {
      toast("当前不在桌面应用中运行", "error");
      return;
    }
    try {
      const picked = await openDialog({
        directory: true,
        multiple: false,
        title: "选择要创建笔记库的父文件夹",
      });
      if (typeof picked !== "string") return;
      const name = window.prompt("新笔记库的名称：", "我的笔记库");
      if (!name?.trim()) return;
      const full = `${picked}\\${name.trim()}`;
      await invoke("create_vault_dir", { path: full });
      await enter(full);
    } catch (e) {
      toast(errText(e), "error");
      void message(String(errText(e)), { title: "创建失败", kind: "error" });
    }
  };

  return (
    <div className="welcome">
      <div className="welcome-inner">
        <div className="brand">
          <div className="brand-mark">🪶</div>
          <h1>栖知</h1>
          <div className="brand-en">Peryx</div>
        </div>
        <p className="tagline">
          以 Markdown 书写，让知识在这里筑巢。
          <br />
          笔记保存在你自己的文件夹里，永远是纯文本文件。
        </p>

        <div className="welcome-actions">
          <button className="btn-primary lg" onClick={chooseFolder} disabled={busy}>
            打开已有的笔记库
          </button>
          <button className="btn-ghost lg" onClick={createVault} disabled={busy}>
            新建一个笔记库
          </button>
        </div>

        <div className="welcome-tips">
          <div className="tip">
            <b>本地优先</b>
            <span>全部内容就是一堆 .md 文件，可用任意编辑器打开</span>
          </div>
          <div className="tip">
            <b>实时渲染</b>
            <span>写作时看到排版效果，一键切回源码查看语法</span>
          </div>
          <div className="tip">
            <b>公式与代码</b>
            <span>支持 LaTeX 数学公式、代码高亮、表格与图片</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * 主面板的标签栏：直接用共享的 TabStrip，接上 store 的动作。
 *
 * 标签现在是「笔记 / PDF / 图片」三类内容的统一容器，
 * 切换时按类型派发到对应的打开动作。
 */

import { useStore } from "@/stores/app";
import { TabStrip } from "@/components/TabStrip";
import type { TabKind } from "@/lib/types";

export function TabBar() {
  const tabs = useStore((s) => s.tabs);
  const note = useStore((s) => s.note);
  const imagePreview = useStore((s) => s.imagePreview);
  const resource = useStore((s) => s.resource);
  const openNote = useStore((s) => s.openNote);
  const openResource = useStore((s) => s.openResource);
  const showImage = useStore((s) => s.showImage);
  const closeTab = useStore((s) => s.closeTab);
  const closeOtherTabs = useStore((s) => s.closeOtherTabs);

  const activePath = imagePreview ?? resource?.path ?? note?.path ?? null;

  /** 按标签类型切换到对应内容（笔记 / PDF / 图片） */
  const activate = (path: string, kind?: TabKind) => {
    if (kind === "pdf") openResource(path);
    else if (kind === "image") showImage(path);
    else void openNote(path);
  };

  return (
    <TabStrip
      pane="main"
      tabs={tabs}
      activePath={activePath}
      onActivate={(p) => {
        const t = tabs.find((x) => x.path === p);
        activate(p, t?.kind);
      }}
      onClose={(p) => void closeTab(p)}
      onCloseOthers={(p) => void closeOtherTabs(p)}
      showKind
    />
  );
}

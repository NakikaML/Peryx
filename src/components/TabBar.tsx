/**
 * 主面板的标签栏：直接用共享的 TabStrip，接上 store 的动作。
 */

import { useStore } from "@/stores/app";
import { TabStrip } from "@/components/TabStrip";

export function TabBar() {
  const tabs = useStore((s) => s.tabs);
  const note = useStore((s) => s.note);
  const imagePreview = useStore((s) => s.imagePreview);
  const openNote = useStore((s) => s.openNote);
  const closeTab = useStore((s) => s.closeTab);
  const closeOtherTabs = useStore((s) => s.closeOtherTabs);

  const activePath = imagePreview ?? note?.path ?? null;

  return (
    <TabStrip
      pane="main"
      tabs={tabs}
      activePath={activePath}
      onActivate={(p) => void openNote(p)}
      onClose={(p) => void closeTab(p)}
      onCloseOthers={(p) => void closeOtherTabs(p)}
    />
  );
}

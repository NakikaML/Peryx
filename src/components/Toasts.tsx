/** 全局提示（Toast） */

import { useStore } from "@/stores/app";

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  const dismiss = useStore((s) => s.dismissToast);

  if (toasts.length === 0) return null;

  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`} onClick={() => dismiss(t.id)}>
          {t.text}
          {t.count > 1 && <span className="toast-count">×{t.count}</span>}
        </div>
      ))}
    </div>
  );
}

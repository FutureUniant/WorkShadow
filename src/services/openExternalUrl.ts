import { isTauriRuntime } from "./storage";

/** 在系统浏览器中打开官网等外链（Tauri 桌面端需 opener 插件） */
export async function openExternalUrl(url: string): Promise<void> {
  const target = url?.trim();
  if (!target) return;

  if (isTauriRuntime()) {
    try {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl(target);
      return;
    } catch {
      /* 回退到 WebView 打开 */
    }
  }

  window.open(target, "_blank", "noopener,noreferrer");
}

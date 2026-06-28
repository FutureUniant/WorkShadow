import { isTauriRuntime } from "./storage";

/** 通过 Tauri 读取系统剪贴板，不触发 WebView 权限弹窗 */
export async function readSystemClipboardText(): Promise<string | null> {
  if (isTauriRuntime()) {
    try {
      const { readText } = await import("@tauri-apps/plugin-clipboard-manager");
      const text = await readText();
      return text || null;
    } catch {
      return null;
    }
  }
  return null;
}

/** 写入系统剪贴板；Tauri 下同样不走浏览器读权限 */
export async function writeSystemClipboardText(text: string): Promise<boolean> {
  if (!text) return false;
  if (isTauriRuntime()) {
    try {
      const { writeText } = await import("@tauri-apps/plugin-clipboard-manager");
      await writeText(text);
      return true;
    } catch {
      return false;
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

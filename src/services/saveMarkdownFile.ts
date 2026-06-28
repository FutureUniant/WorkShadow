import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { normalizePickedPath } from "./pickDirectory";
import { isTauriRuntime } from "./storage";

function downloadInBrowser(text: string, fileName: string) {
  const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/** 将 Markdown 文本保存到用户选择的路径（桌面版）或触发浏览器下载。 */
export async function saveMarkdownFile(text: string, defaultName: string): Promise<boolean> {
  const fileName = defaultName.endsWith(".md") ? defaultName : `${defaultName}.md`;

  if (isTauriRuntime()) {
    const path = await save({
      filters: [{ name: "Markdown", extensions: ["md", "markdown"] }],
      defaultPath: fileName
    });
    if (!path) return false;
    const raw = Array.isArray(path) ? path[0] : path;
    if (!raw) return false;
    await invoke("write_text_file", {
      path: normalizePickedPath(raw),
      content: text
    });
    return true;
  }

  downloadInBrowser(text, fileName);
  return true;
}

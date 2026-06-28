import { useCallback, useEffect, useState } from "react";
import { Maximize2, Minus, Square, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauriRuntime } from "../services/storage";
/** Tauri 打包用图标（与 `tauri.conf.json` bundle 同源），标题栏用 32px 资源在高分屏下更清晰 */
import titleBarIconUrl from "../../src-tauri/icons/32x32.png";

export function DesktopTitleBar({ title }: { title?: string }) {
  const { t } = useTranslation();
  const isTauri = isTauriRuntime();
  const [maximized, setMaximized] = useState(false);
  const displayTitle = title?.trim() || t("appName");

  const syncMaximized = useCallback(() => {
    if (!isTauri) return;
    void getCurrentWindow()
      .isMaximized()
      .then(setMaximized)
      .catch(() => {});
  }, [isTauri]);

  useEffect(() => {
    if (!isTauri) return;
    const w = getCurrentWindow();
    void w.isMaximized().then(setMaximized).catch(() => {});
    let unlisten: (() => void) | undefined;
    void w
      .onResized(() => {
        void w.isMaximized().then(setMaximized).catch(() => {});
      })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => {});
    return () => {
      unlisten?.();
    };
  }, [isTauri]);

  if (!isTauri) return null;

  const w = getCurrentWindow();

  return (
    <header className="desktop-titlebar">
      <div
        className="desktop-titlebar__drag"
        data-tauri-drag-region
        onDoubleClick={() => {
          void w.toggleMaximize().then(syncMaximized);
        }}
      >
        <img className="desktop-titlebar__logo" src={titleBarIconUrl} alt="" width={22} height={22} decoding="async" />
        <span className="desktop-titlebar__title">{displayTitle}</span>
      </div>
      <div className="desktop-titlebar__controls">
        <button
          type="button"
          className="desktop-titlebar__btn desktop-titlebar__btn--min"
          aria-label={t("windowMinimize")}
          onClick={() => void w.minimize()}
        >
          <Minus size={16} strokeWidth={2} aria-hidden />
        </button>
        <button
          type="button"
          className="desktop-titlebar__btn desktop-titlebar__btn--max"
          aria-label={maximized ? t("windowRestore") : t("windowMaximize")}
          onClick={() => void w.toggleMaximize().then(syncMaximized)}
        >
          {maximized ? <Square size={14} strokeWidth={2} aria-hidden /> : <Maximize2 size={14} strokeWidth={2} aria-hidden />}
        </button>
        <button
          type="button"
          className="desktop-titlebar__btn desktop-titlebar__btn--close"
          aria-label={t("windowClose")}
          onClick={() => void w.close()}
        >
          <X size={16} strokeWidth={2} aria-hidden />
        </button>
      </div>
    </header>
  );
}

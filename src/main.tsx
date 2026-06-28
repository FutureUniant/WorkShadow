import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { LogWindowApp } from "./LogWindowApp";
import { ErrorReportingSurface } from "./components/ErrorReportingSurface";
import { TextContextMenu } from "./components/TextContextMenu";
import faviconUrl from "./assets/logo.png";
import "./i18n";
import "./styles.css";
import { installProductionUiGuards } from "./services/productionUiGuards";
import { resolveLogWindowId } from "./services/logWindow";
import { installWindowDragPerf } from "./services/windowDragPerf";

installProductionUiGuards();
installWindowDragPerf();

let link = document.querySelector<HTMLLinkElement>("link[rel='icon']");
if (!link) {
  link = document.createElement("link");
  link.rel = "icon";
  link.type = "image/png";
  document.head.appendChild(link);
}
link.href = faviconUrl;

const logWindowId = resolveLogWindowId();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorReportingSurface>
      {logWindowId ? <LogWindowApp logId={logWindowId} /> : <App />}
      <TextContextMenu />
    </ErrorReportingSurface>
  </React.StrictMode>
);

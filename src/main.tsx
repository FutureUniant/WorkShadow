import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ErrorReportingSurface } from "./components/ErrorReportingSurface";
import { TextContextMenu } from "./components/TextContextMenu";
import faviconUrl from "./assets/logo.png";
import "./i18n";
import "./styles.css";

let link = document.querySelector<HTMLLinkElement>("link[rel='icon']");
if (!link) {
  link = document.createElement("link");
  link.rel = "icon";
  link.type = "image/png";
  document.head.appendChild(link);
}
link.href = faviconUrl;

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorReportingSurface>
      <App />
      <TextContextMenu />
    </ErrorReportingSurface>
  </React.StrictMode>
);

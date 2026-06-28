import fs from "node:fs";

const path = "src/styles.css";
let css = fs.readFileSync(path, "utf8");

function removeBetween(css, startMarker, endMarker) {
  const start = css.indexOf(startMarker);
  const end = css.indexOf(endMarker, start);
  if (start === -1 || end === -1) {
    throw new Error(`Markers not found: ${startMarker} -> ${endMarker}`);
  }
  return css.slice(0, start) + css.slice(end);
}

// settings-dev-* through settings-dev-logs-view block
css = removeBetween(css, ".settings-dev-error-btns {", ".batch-layer {");

// onboarding tour
css = removeBetween(css, "/* ---------- 新手引导：聚光灯 + 水波纹 ---------- */", ".modal-actions {");

// text completion overlay
css = removeBetween(css, ".editor-text-completion-overlay {", ".workspace-ask__question-wrap {");

// account / billing UI (keep generic settings-field invalid styles below)
css = removeBetween(css, ".account-login-form {", ".settings-data-actions .primary,");

fs.writeFileSync(path, css);
console.log("Pruned styles.css");

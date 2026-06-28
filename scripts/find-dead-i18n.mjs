import fs from "node:fs";
import path from "node:path";

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory() && !["node_modules", "dist"].includes(e.name)) out.push(...walk(p));
    else if (/\.(ts|tsx)$/.test(p) && !p.includes("i18n")) out.push(p);
  }
  return out;
}

const src = walk("src").map((f) => fs.readFileSync(f, "utf8")).join("\n");
const i18n = fs.readFileSync("src/i18n/index.ts", "utf8");
const zhBlock = i18n.split("zh:")[1].split("en:")[0];
const keys = [...zhBlock.matchAll(/^\s+([a-zA-Z0-9_.]+):/gm)].map((m) => m[1]);
const used = new Set();
const patterns = [
  /t\(\s*["']([^"']+)["']/g,
  /i18n\.t\(\s*["']([^"']+)["']/g,
  /title:\s*["']([^"']+)["']/g,
  /summary:\s*["']([^"']+)["']/g,
  /labelKey:\s*["']([^"']+)["']/g,
  /userMessageKey:\s*["']([^"']+)["']/g,
  /userHintKey:\s*["']([^"']+)["']/g,
  /actionLabelKey:\s*["']([^"']+)["']/g
];
for (const p of patterns) {
  let m;
  while ((m = p.exec(src))) used.add(m[1]);
}
const dead = keys.filter((k) => !used.has(k));
const missing = [...used].filter((k) => !keys.includes(k)).sort();
console.log(JSON.stringify({ defined: keys.length, used: used.size, dead, missing }, null, 2));

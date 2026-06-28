import fs from "node:fs";

const REMOVE_PREFIXES = [
  "onboarding",
  "settingsDev",
  "account",
  "workshadowApi",
  "workshadowLlmTier",
  "textCompletion",
  "shortcutActionTextCompletion",
  "billingError",
  "useWorkshadow"
];

const REMOVE_KEYS = new Set([
  "settingsCategoryDeveloper",
  "settingsCategoryAccount",
  "settingsSubWorkspace",
  "shortcutErrCompletionNeedModifier",
  "customModelsFieldsetLabel",
  "customModelsHiddenOfficial",
  "customModelsLockedOfficial",
  "workshadowApiRequestFailedMessage",
  "workshadowApiRequestFailedHint",
  "vlmImageAnnotationFailed",
  "vlmVideoAnnotationFailed",
  "workspaceAskBusy",
  "saveDoneHint",
  "folder",
  "log",
  "vlmConfig",
  "toolbarMathInline",
  "toolbarMathBlock",
  "toolbarMathPrompt",
  "toolbarMathBlockPrompt",
  "toolbarImageAlt",
  "toolbarImagePrompt",
  "toolbarVideoAlt",
  "toolbarVideoPrompt",
  "dialogLinkNeedSelection",
  "dialogMediaAltLabel",
  "videoEmbedSkipAnnotation",
  "dialogMediaVideoEmbedHint"
]);

function shouldRemove(key) {
  if (REMOVE_KEYS.has(key)) return true;
  return REMOVE_PREFIXES.some((p) => key.startsWith(p));
}

function pruneBlock(lines) {
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const keyMatch = lines[i].match(/^      ([a-zA-Z0-9_.]+):/);
    if (keyMatch && shouldRemove(keyMatch[1])) {
      i++;
      while (i < lines.length && !/^      [a-zA-Z0-9_.]+:/.test(lines[i])) {
        i++;
      }
      continue;
    }
    out.push(lines[i]);
    i++;
  }
  return out;
}

const path = "src/i18n/index.ts";
const raw = fs.readFileSync(path, "utf8");
const zhStart = raw.indexOf("zh: {");
const enStart = raw.indexOf("en: {");
const zhTranslationStart = raw.indexOf("translation: {", zhStart);
const enTranslationStart = raw.indexOf("translation: {", enStart);
const zhBodyStart = raw.indexOf("\n", zhTranslationStart) + 1;
const enBodyStart = raw.indexOf("\n", enTranslationStart) + 1;
const zhBodyEnd = raw.lastIndexOf("    }", enStart);
const enBodyEnd = raw.lastIndexOf("    }");

const head = raw.slice(0, zhBodyStart);
const zhLines = raw.slice(zhBodyStart, zhBodyEnd).split("\n");
const mid = raw.slice(zhBodyEnd, enBodyStart);
const enLines = raw.slice(enBodyStart, enBodyEnd).split("\n");
const tail = raw.slice(enBodyEnd);

const prunedZh = pruneBlock(zhLines);
const prunedEn = pruneBlock(enLines);
const next = head + prunedZh.join("\n") + mid + prunedEn.join("\n") + tail;
fs.writeFileSync(path, next);
console.log("Pruned i18n:", { zhRemoved: zhLines.length - prunedZh.length, enRemoved: enLines.length - prunedEn.length });

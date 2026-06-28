import pkg from "../../package.json";

/** 界面与安装包展示用版本号 */
export function getDisplayVersion(): string {
  return pkg.version.replace(/-(Pro|Dev|Standard|AI)$/i, "");
}

export function getProductName(): string {
  return "WorkShadow";
}

import { describe, expect, it } from "vitest";

/** 与 tableCellVertical.ts 中 buildCellPresentation 逻辑一致 */
function buildCellPresentation(attrs: Record<string, unknown>) {
  const styleParts: string[] = [];
  const align = attrs.align as string | null | undefined;
  if (align) styleParts.push(`text-align: ${align}`);
  const valign = attrs.verticalAlign as string | null | undefined;
  if (valign) styleParts.push(`vertical-align: ${valign}`);
  const bg = attrs.backgroundColor as string | null | undefined;
  if (bg) styleParts.push(`background-color: ${bg}`);

  const result: Record<string, string> = {};
  if (styleParts.length) result.style = styleParts.join("; ");
  if (bg) result.bgcolor = bg;
  return result;
}

describe("table cell presentation attrs", () => {
  it("merges align, verticalAlign and backgroundColor for clipboard HTML", () => {
    expect(
      buildCellPresentation({
        align: "center",
        verticalAlign: "middle",
        backgroundColor: "#ffeeaa"
      })
    ).toEqual({
      style: "text-align: center; vertical-align: middle; background-color: #ffeeaa",
      bgcolor: "#ffeeaa"
    });
  });
});

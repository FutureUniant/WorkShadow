import { describe, expect, it } from "vitest";
import { tiptapToExportMarkdown } from "./markdown";

describe("tiptapToExportMarkdown", () => {
  it("skips images and exports tables as HTML", () => {
    const md = tiptapToExportMarkdown({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "正文段落保留。" }] },
        {
          type: "table",
          content: [
            {
              type: "tableRow",
              content: [
                {
                  type: "tableHeader",
                  attrs: { align: "center", backgroundColor: "#ffeecc" },
                  content: [{ type: "text", text: "列A" }]
                },
                { type: "tableHeader", content: [{ type: "text", text: "列B" }] }
              ]
            },
            {
              type: "tableRow",
              content: [
                { type: "tableCell", content: [{ type: "text", text: "单元格内容" }] },
                { type: "tableCell", content: [{ type: "text", text: "另一格" }] }
              ]
            }
          ]
        },
        {
          type: "image",
          attrs: {
            src: "file:///C:/secret.png",
            caption: "架构草图"
          }
        }
      ]
    });

    expect(md).toContain("正文段落保留");
    expect(md).toContain("<table>");
    expect(md).toContain("<th");
    expect(md).toContain("列A");
    expect(md).toContain("单元格内容");
    expect(md).not.toContain("secret.png");
    expect(md).not.toContain("架构草图");
    expect(md).not.toContain("| 列A |");
  });
});

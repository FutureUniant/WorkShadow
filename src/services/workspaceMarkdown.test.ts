import { describe, expect, it } from "vitest";
import { normalizeWorkspaceMarkdown } from "./workspaceMarkdown";

describe("normalizeWorkspaceMarkdown", () => {
  it("preserves intentional paragraph breaks", () => {
    const input = "今日完成接口改造。\n\n已进入联调阶段。";
    expect(normalizeWorkspaceMarkdown(input)).toBe(input);
  });

  it("merges hard wraps without blank lines between prose lines", () => {
    const input = "第一行说明\n第二行说明\n第三行说明";
    expect(normalizeWorkspaceMarkdown(input)).toBe("第一行说明第二行说明第三行说明");
  });

  it("keeps headings and list structure", () => {
    const input = "## 概述\n\n- 事项 A\n- 事项 B";
    expect(normalizeWorkspaceMarkdown(input)).toBe(input);
  });

  it("does not alter fenced code blocks", () => {
    const input = "```ts\nconst a = 1;\n\nconst b = 2;\n```";
    expect(normalizeWorkspaceMarkdown(input)).toBe(input);
  });

  it("collapses excessive blank lines", () => {
    const input = "段落一\n\n\n\n段落二";
    expect(normalizeWorkspaceMarkdown(input)).toBe("段落一\n\n段落二");
  });

  it("preserves paragraph breaks between structural blocks", () => {
    const input = "## 第一节\n\n\n\n## 第二节";
    expect(normalizeWorkspaceMarkdown(input)).toBe("## 第一节\n\n## 第二节");
  });

  it("repairs common compact markdown emitted by log summaries", () => {
    const input =
      "# 标题\n\n##一、工作概述\n近期完成优化。## 二、主要进展\n1.**验证数据规模**- 训练集扩充至766张。-结论明确。\n2. **完成数据校验**-对数据完成修正。";

    expect(normalizeWorkspaceMarkdown(input)).toBe(
      "# 标题\n\n## 一、工作概述\n近期完成优化。\n\n## 二、主要进展\n1. **验证数据规模**\n- 训练集扩充至766张。\n- 结论明确。\n2. **完成数据校验**\n- 对数据完成修正。"
    );
  });

  it("splits headings from following ordered-list items", () => {
    const input = "##三、问题与风险1. **标注质量**- 存在漏标。";
    expect(normalizeWorkspaceMarkdown(input)).toBe("## 三、问题与风险\n\n1. **标注质量**\n- 存在漏标。");
  });
});

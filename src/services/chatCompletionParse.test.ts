import { describe, expect, it } from "vitest";
import {
  extractChatCompletionDeltaFromSseLine,
  extractChatCompletionText
} from "./chatCompletionParse";

describe("extractChatCompletionText", () => {
  it("reads message.content", () => {
    expect(
      extractChatCompletionText({
        choices: [{ message: { content: "OK" } }]
      })
    ).toBe("OK");
  });

  it("falls back to reasoning_content when allowed", () => {
    expect(
      extractChatCompletionText(
        {
          choices: [{ message: { content: "", reasoning_content: "thinking…" } }]
        },
        { allowReasoningFallback: true }
      )
    ).toBe("thinking…");
  });

  it("ignores reasoning_content for answer mode", () => {
    expect(
      extractChatCompletionText({
        choices: [{ message: { content: "", reasoning_content: "thinking…" } }]
      })
    ).toBe("");
  });

  it("throws API error message from body", () => {
    expect(() =>
      extractChatCompletionText({ error: { message: "Invalid API key" } })
    ).toThrow("Invalid API key");
  });
});

describe("extractChatCompletionDeltaFromSseLine", () => {
  it("parses content delta", () => {
    expect(
      extractChatCompletionDeltaFromSseLine(
        'data: {"choices":[{"delta":{"content":"hi"}}]}'
      )
    ).toBe("hi");
  });
});

import { describe, expect, it } from "vitest";
import { buildLogQaSystem, buildLogSummarySystem } from "./workshadowPrompt";

describe("workshadowPrompt", () => {
  it("buildLogSummarySystem is English when locale is not zh", () => {
    const system = buildLogSummarySystem(false);
    expect(system).toMatch(/local-first/i);
    expect(system).not.toMatch(/你是 WorkShadow/);
  });

  it("buildLogQaSystem is Chinese when locale is zh", () => {
    const system = buildLogQaSystem(true);
    expect(system).toMatch(/你是 WorkShadow/);
    expect(system).toMatch(/Markdown/);
  });

  it("buildLogQaSystem asks for Markdown output in English", () => {
    const system = buildLogQaSystem(false);
    expect(system).toMatch(/Markdown/i);
  });
});

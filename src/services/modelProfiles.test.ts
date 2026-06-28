import { describe, expect, it } from "vitest";
import {
  coerceSingleModelProfile,
  normalizeModelProfiles,
  sanitizeModelProfiles,
  switchModelProviderProfile,
  upsertModelProfile
} from "./modelProfiles";

describe("modelProfiles", () => {
  it("migrates active config into profiles on load", () => {
    const profiles = normalizeModelProfiles(undefined, {
      provider: "deepseek",
      baseUrl: "https://api.deepseek.com/v1",
      apiKey: "sk-test",
      model: "deepseek-chat"
    });
    expect(profiles.deepseek?.model).toBe("deepseek-chat");
  });

  it("keeps separate records per provider when switching", () => {
    let profiles = {};
    const deepseek = {
      provider: "deepseek" as const,
      baseUrl: "https://api.deepseek.com/v1",
      apiKey: "ds-key",
      model: "deepseek-chat"
    };
    profiles = upsertModelProfile(profiles, deepseek);

    const switched = switchModelProviderProfile(profiles, deepseek, "aliyun");
    profiles = switched.profiles;
    const aliyun = {
      provider: "aliyun" as const,
      baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      apiKey: "ali-key",
      model: "qwen-plus"
    };
    profiles = upsertModelProfile(profiles, aliyun);

    const back = switchModelProviderProfile(profiles, aliyun, "deepseek");
    expect(back.active.apiKey).toBe("ds-key");
    expect(back.active.model).toBe("deepseek-chat");
    expect(back.profiles.aliyun?.model).toBe("qwen-plus");
  });

  it("keeps only one profile per provider when raw data is an array", () => {
    const profiles = normalizeModelProfiles({
      deepseek: [
        { baseUrl: "https://old.example/v1", apiKey: "old", model: "old-model" },
        { baseUrl: "https://api.deepseek.com/v1", apiKey: "new", model: "deepseek-chat" }
      ]
    });
    expect(profiles.deepseek?.apiKey).toBe("new");
    expect(Object.keys(profiles)).toEqual(["deepseek"]);
  });

  it("sanitize drops unknown provider keys and duplicate aliases", () => {
    const profiles = sanitizeModelProfiles({
      deepseek: { baseUrl: "https://api.deepseek.com/v1", apiKey: "k", model: "m" },
      unknown_vendor: { baseUrl: "x", apiKey: "y", model: "z" }
    } as never);
    expect(Object.keys(profiles)).toEqual(["deepseek"]);
  });

  it("coerceSingleModelProfile returns last array entry", () => {
    const row = coerceSingleModelProfile([
      { baseUrl: "a", apiKey: "1", model: "first" },
      { baseUrl: "b", apiKey: "2", model: "second" }
    ]);
    expect(row?.model).toBe("second");
  });
});

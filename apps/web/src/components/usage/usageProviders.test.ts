import { describe, expect, it } from "vite-plus/test";

import { accountLimitEmptyStateCopy } from "./usageProviders";

describe("accountLimitEmptyStateCopy", () => {
  it("sets the first-turn expectation when Claude has no limit snapshot", () => {
    expect(accountLimitEmptyStateCopy("claude", false)).toBe(
      "No limit data yet — appears after your first Claude turn.",
    );
  });

  it("preserves loading and provider-specific empty states", () => {
    expect(accountLimitEmptyStateCopy("claude", true)).toBe("Loading…");
    expect(accountLimitEmptyStateCopy("codex", false)).toBe("No limit data yet");
    expect(accountLimitEmptyStateCopy("kimi", false)).toBe("Limits not reported by provider.");
    expect(accountLimitEmptyStateCopy("ollama", true)).toBe("Local — free");
  });
});

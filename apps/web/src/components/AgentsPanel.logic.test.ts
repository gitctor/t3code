import { describe, expect, it } from "vite-plus/test";

import { canOpenAgentTranscript } from "./AgentsPanel.logic";

describe("agent transcript drawer predicate", () => {
  it("opens only after a child thread exists", () => {
    expect(canOpenAgentTranscript({ childThreadId: null })).toBe(false);
    expect(canOpenAgentTranscript({})).toBe(false);
    expect(canOpenAgentTranscript({ childThreadId: "child-1" as never })).toBe(true);
  });
});

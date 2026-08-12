import { expect, it } from "@effect/vitest";
import { CrewId, ProviderInstanceId, type ResolvedCrew } from "@t3tools/contracts";

import { buildCrewBriefing } from "./CrewBriefing.ts";

const codex = ProviderInstanceId.make("codex");
const claude = ProviderInstanceId.make("claude");
const resolvedCrew: ResolvedCrew = {
  crew: {
    id: CrewId.make("deep_build"),
    name: "Deep Build",
    planner: { instanceId: claude, model: "claude-opus-5" },
    members: [{ instanceId: codex, model: "gpt-5.6-sol", role: "build" }, { instanceId: claude }],
  },
  plannerAvailable: true,
  availableMemberIds: [codex],
};

it("builds the complete provider-neutral planner briefing", () => {
  const briefing = buildCrewBriefing({
    resolvedCrew,
    memberDisplayNames: new Map([
      [codex, "Codex"],
      [claude, "Claude"],
    ]),
  });

  expect(briefing).toContain("Crew: Deep Build (deep_build)");
  expect(briefing).toContain(
    "instanceId: codex; display name: Codex; model: gpt-5.6-sol; role: build; availability: available",
  );
  expect(briefing).toContain(
    "instanceId: claude; display name: Claude; model: instance default; role: not set; availability: unavailable",
  );
  expect(briefing).toContain("Parallelize independent work.");
  expect(briefing).toContain("fromDispatchId");
  expect(briefing).toContain("list_dispatches");
  expect(briefing).toContain("timeoutSeconds` to 300 or less");
  expect(briefing).toContain(
    "You are the planner. Hand implementation to the crew; do not do a member's work yourself unless every relevant member declined.",
  );
});

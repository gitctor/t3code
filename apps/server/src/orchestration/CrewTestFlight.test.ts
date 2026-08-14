import { describe, expect, it } from "vite-plus/test";
import {
  CrewId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
} from "@t3tools/contracts";

import type { CrewRegistryEntry } from "./Services/CrewRegistry.ts";
import { buildCrewTestFlightPlan } from "./CrewTestFlight.ts";

const plannerId = ProviderInstanceId.make("planner");
const codexId = ProviderInstanceId.make("codex-builder");
const kimiId = ProviderInstanceId.make("kimi-reviewer");
const missingId = ProviderInstanceId.make("missing-designer");

const provider = (
  instanceId: ProviderInstanceId,
  driver: string,
  models: ReadonlyArray<{ readonly slug: string; readonly isDefault?: boolean }>,
): ServerProvider => ({
  instanceId,
  driver: ProviderDriverKind.make(driver),
  enabled: true,
  installed: true,
  version: "1.0.0",
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: "2026-08-13T12:00:00.000Z",
  models: models.map((model) => ({
    slug: model.slug,
    name: model.slug,
    isCustom: false,
    ...(model.isDefault ? { isDefault: true } : {}),
    capabilities: null,
  })),
  slashCommands: [],
  skills: [],
});

const entry: CrewRegistryEntry = {
  resolvedCrew: {
    crew: {
      id: CrewId.make("flight-crew"),
      name: "Flight Crew",
      planner: {
        instanceId: plannerId,
        model: "claude-opus-5",
        options: [{ id: "effort", value: "high" }],
      },
      members: [
        {
          instanceId: codexId,
          model: "gpt-5.6-sol",
          role: "build",
          options: [{ id: "reasoningEffort", value: "xhigh" }],
        },
        { instanceId: kimiId, model: "kimi-code/k3", role: "review" },
        { instanceId: missingId, role: "design" },
      ],
    },
    plannerAvailable: true,
    availableMemberIds: [codexId, kimiId],
  },
  memberDisplayNames: new Map([
    [codexId, "Codex Builder"],
    [kimiId, "Kimi Reviewer"],
  ]),
};

describe("buildCrewTestFlightPlan", () => {
  it("freezes the cheapest planner and seat models without saved options", () => {
    const plan = buildCrewTestFlightPlan(entry, [
      provider(plannerId, "claudeAgent", [
        { slug: "claude-opus-5", isDefault: true },
        { slug: "claude-haiku-4-5" },
      ]),
      provider(codexId, "codex", [
        { slug: "gpt-5.6-sol", isDefault: true },
        { slug: "gpt-5.3-codex-spark" },
        { slug: "gpt-5.6-mini" },
      ]),
      provider(kimiId, "kimi", [
        { slug: "kimi-code/k3", isDefault: true },
        { slug: "kimi-code/kimi-for-coding-highspeed" },
      ]),
    ]);

    expect(plan?.plannerModelSelection).toEqual({
      instanceId: plannerId,
      model: "claude-haiku-4-5",
    });
    expect(plan?.turnInput).toEqual({
      seatOverrides: [
        { instanceId: codexId, model: "gpt-5.6-mini" },
        { instanceId: kimiId, model: "kimi-code/kimi-for-coding-highspeed" },
      ],
    });
    expect(plan?.prompt).toContain("availability: unavailable");
    expect(plan?.prompt).toContain("Do not edit files.");
    expect(entry.resolvedCrew.crew.planner.model).toBe("claude-opus-5");
    expect(entry.resolvedCrew.crew.members[0]?.model).toBe("gpt-5.6-sol");
  });
});

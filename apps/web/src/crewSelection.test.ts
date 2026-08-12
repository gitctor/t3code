import {
  CrewId,
  ProviderDriverKind,
  ProviderInstanceId,
  type Crew,
  type ServerProvider,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { deriveProviderInstanceEntries } from "./providerInstances";
import {
  CREW_UNAVAILABLE_COPY,
  getCrewUnavailableReason,
  makeCrewId,
  sortCrews,
} from "./crewSelection";

function provider(id: string, overrides: Partial<ServerProvider> = {}): ServerProvider {
  return {
    instanceId: ProviderInstanceId.make(id),
    driver: ProviderDriverKind.make("codex"),
    enabled: true,
    installed: true,
    version: null,
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-08-12T00:00:00.000Z",
    models: [],
    slashCommands: [],
    skills: [],
    ...overrides,
  };
}

function crew(id: string, planner = "planner", members = ["builder"]): Crew {
  return {
    id: CrewId.make(id),
    name: id,
    planner: { instanceId: ProviderInstanceId.make(planner), model: "gpt-5.6" },
    members: members.map((member) => ({ instanceId: ProviderInstanceId.make(member) })),
  };
}

describe("crew picker availability", () => {
  it("maps every degraded state to the final user-facing copy", () => {
    expect(getCrewUnavailableReason(crew("missing"), [])).toBe("planner-instance-missing");
    expect(CREW_UNAVAILABLE_COPY["planner-instance-missing"]).toBe("Planner not installed");

    const signedOut = deriveProviderInstanceEntries([
      provider("planner", { auth: { status: "unauthenticated" } }),
      provider("builder"),
    ]);
    expect(getCrewUnavailableReason(crew("signed-out"), signedOut)).toBe(
      "planner-instance-unavailable",
    );
    expect(CREW_UNAVAILABLE_COPY["planner-instance-unavailable"]).toBe(
      "Planner is signed out or unavailable",
    );

    const noMembers = deriveProviderInstanceEntries([provider("planner")]);
    expect(getCrewUnavailableReason(crew("no-members"), noMembers)).toBe("no-available-members");
    expect(CREW_UNAVAILABLE_COPY["no-available-members"]).toBe("No crew members are available");
  });

  it("sorts recent crews first and falls back to name", () => {
    const alpha = { ...crew("alpha"), name: "Alpha" };
    const beta = { ...crew("beta"), name: "Beta" };
    const gamma = { ...crew("gamma"), name: "Gamma" };
    expect(sortCrews([gamma, alpha, beta], { beta: 2, gamma: 1 }).map((item) => item.id)).toEqual([
      "beta",
      "gamma",
      "alpha",
    ]);
  });

  it("creates stable collision-safe crew ids", () => {
    expect(makeCrewId("Design + Build", new Set())).toBe("design-build");
    expect(makeCrewId("Design + Build", new Set(["design-build"]))).toBe("design-build-2");
    expect(makeCrewId("123", new Set())).toBe("crew-123");
  });
});

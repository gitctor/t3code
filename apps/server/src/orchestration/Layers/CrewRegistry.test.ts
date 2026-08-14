import { expect, it } from "@effect/vitest";
import {
  CrewId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ResolvedCrew,
  type ServerProvider,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";

import { make, makeHydrated } from "./CrewRegistry.ts";

const crewId = CrewId.make("deep_build");
const instanceId = ProviderInstanceId.make("codex");
const memberInstanceId = ProviderInstanceId.make("claude_work");
const now = "2026-08-11T12:00:00.000Z";
const resolvedCrew: ResolvedCrew = {
  crew: {
    id: crewId,
    name: "Deep Build",
    planner: { instanceId, model: "gpt-5.6-sol" },
    members: [{ instanceId }],
  },
  plannerAvailable: true,
  availableMemberIds: [instanceId],
};

it.effect("starts empty and resolves unknown crew ids without failing", () =>
  Effect.gen(function* () {
    const registry = make();
    expect(yield* registry.resolve(crewId)).toBeUndefined();
    expect(yield* registry.listCrewIds).toEqual([]);
  }),
);

it.effect("resolves an in-memory crew entry", () =>
  Effect.gen(function* () {
    const entry = {
      resolvedCrew,
      memberDisplayNames: new Map([[instanceId, "Codex"]]),
    };
    const registry = make([entry]);
    expect(yield* registry.resolve(crewId)).toBe(entry);
    expect(yield* registry.listCrewIds).toEqual([crewId]);
  }),
);

const provider = (input: {
  readonly instanceId: ProviderInstanceId;
  readonly driver: "codex" | "claudeAgent";
  readonly available: boolean;
  readonly displayName?: string;
}): ServerProvider => ({
  instanceId: input.instanceId,
  driver: ProviderDriverKind.make(input.driver),
  ...(input.displayName ? { displayName: input.displayName } : {}),
  enabled: input.available,
  installed: input.available,
  version: "1.0.0",
  status: input.available ? "ready" : "disabled",
  auth: { status: input.available ? "authenticated" : "unauthenticated" },
  checkedAt: now,
  availability: input.available ? "available" : "unavailable",
  models: [],
  slashCommands: [],
  skills: [],
});

it.effect("keeps authored crews visible and degrades them from live provider state", () =>
  Effect.gen(function* () {
    const crew = {
      id: crewId,
      name: "Deep Build",
      planner: { instanceId, model: "gpt-5.6-sol" },
      members: [{ instanceId: memberInstanceId }],
    };
    const providersRef = yield* Ref.make<ReadonlyArray<ServerProvider>>([
      provider({ instanceId, driver: "codex", available: true }),
      provider({
        instanceId: memberInstanceId,
        driver: "claudeAgent",
        available: true,
        displayName: "Claude Work",
      }),
    ]);
    const registry = makeHydrated({
      getCrews: Effect.succeed([crew]),
      getProviders: Ref.get(providersRef),
    });

    const ready = yield* registry.resolve(crewId);
    expect(ready?.resolvedCrew.availableMemberIds).toEqual([memberInstanceId]);
    expect(ready?.memberDisplayNames.get(memberInstanceId)).toBe("Claude Work");

    yield* Ref.set(providersRef, [
      provider({ instanceId, driver: "codex", available: false }),
      provider({ instanceId: memberInstanceId, driver: "claudeAgent", available: true }),
    ]);
    const signedOut = yield* registry.resolve(crewId);
    expect(signedOut).not.toBeUndefined();
    expect(signedOut?.resolvedCrew.plannerAvailable).toBe(false);
    expect(signedOut?.resolvedCrew.unavailableReason).toBe("planner-instance-unavailable");
    expect(signedOut?.memberDisplayNames.get(memberInstanceId)).toBe("Claude");
  }),
);

it.effect("reports a missing planner without dropping the crew", () =>
  Effect.gen(function* () {
    const registry = makeHydrated({
      getCrews: Effect.succeed([
        {
          id: crewId,
          name: "Deep Build",
          planner: { instanceId, model: "gpt-5.6-sol" },
          members: [{ instanceId: memberInstanceId }],
        },
      ]),
      getProviders: Effect.succeed([
        provider({ instanceId: memberInstanceId, driver: "claudeAgent", available: true }),
      ]),
    });

    const missing = yield* registry.resolve(crewId);
    expect(missing).not.toBeUndefined();
    expect(missing?.resolvedCrew.unavailableReason).toBe("planner-instance-missing");
  }),
);

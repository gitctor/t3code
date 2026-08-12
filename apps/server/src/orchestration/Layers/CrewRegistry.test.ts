import { expect, it } from "@effect/vitest";
import { CrewId, ProviderInstanceId, type ResolvedCrew } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { make } from "./CrewRegistry.ts";

const crewId = CrewId.make("deep_build");
const instanceId = ProviderInstanceId.make("codex");
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
    expect(yield* make().resolve(crewId)).toBeUndefined();
  }),
);

it.effect("resolves an in-memory crew entry", () =>
  Effect.gen(function* () {
    const entry = {
      resolvedCrew,
      memberDisplayNames: new Map([[instanceId, "Codex"]]),
    };
    expect(yield* make([entry]).resolve(crewId)).toBe(entry);
  }),
);

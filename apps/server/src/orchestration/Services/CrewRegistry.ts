import type { CrewId, ProviderInstanceId, ResolvedCrew } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";

export interface CrewRegistryEntry {
  readonly resolvedCrew: ResolvedCrew;
  readonly memberDisplayNames: ReadonlyMap<ProviderInstanceId, string>;
}

export interface CrewRegistryShape {
  readonly resolve: (crewId: CrewId) => Effect.Effect<CrewRegistryEntry | undefined>;
}

export const CrewRegistry = Context.Reference<CrewRegistryShape>(
  "t3/orchestration/Services/CrewRegistry",
  {
    defaultValue: (): CrewRegistryShape => ({
      resolve: Effect.fn("CrewRegistry.resolveEmpty")(function* () {
        return undefined;
      }),
    }),
  },
);

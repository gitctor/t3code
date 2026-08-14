import type { CrewId, ProviderInstanceId, ResolvedCrew } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";

export interface CrewRegistryEntry {
  readonly resolvedCrew: ResolvedCrew;
  readonly memberDisplayNames: ReadonlyMap<ProviderInstanceId, string>;
}

export interface CrewRegistryShape {
  readonly resolve: (crewId: CrewId) => Effect.Effect<CrewRegistryEntry | undefined>;
  readonly listCrewIds: Effect.Effect<ReadonlyArray<CrewId>>;
}

export class CrewRegistry extends Context.Service<CrewRegistry, CrewRegistryShape>()(
  "t3/orchestration/Services/CrewRegistry",
) {}

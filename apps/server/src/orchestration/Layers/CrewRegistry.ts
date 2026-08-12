import type { CrewId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import {
  CrewRegistry,
  type CrewRegistryEntry,
  type CrewRegistryShape,
} from "../Services/CrewRegistry.ts";

export const make = (entries: ReadonlyArray<CrewRegistryEntry> = []): CrewRegistryShape => {
  const entriesById = new Map<CrewId, CrewRegistryEntry>(
    entries.map((entry) => [entry.resolvedCrew.crew.id, entry]),
  );
  return {
    resolve: Effect.fn("CrewRegistry.resolve")(function* (crewId) {
      return entriesById.get(crewId);
    }),
  };
};

export const CrewRegistryLive = Layer.succeed(CrewRegistry, make());

import {
  isProviderAvailable,
  PROVIDER_DISPLAY_NAMES,
  type CrewId,
  type ProviderInstanceId,
  type ServerProvider,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { ProviderRegistry } from "../../provider/Services/ProviderRegistry.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import {
  CrewRegistry,
  type CrewRegistryEntry,
  type CrewRegistryShape,
} from "../Services/CrewRegistry.ts";

const isReady = (provider: ServerProvider): boolean =>
  isProviderAvailable(provider) &&
  provider.enabled &&
  provider.installed &&
  provider.status === "ready" &&
  provider.auth.status !== "unauthenticated";

const displayName = (provider: ServerProvider): string =>
  provider.displayName ?? PROVIDER_DISPLAY_NAMES[provider.driver] ?? String(provider.instanceId);

export const make = (entries: ReadonlyArray<CrewRegistryEntry> = []): CrewRegistryShape => {
  const entriesById = new Map<CrewId, CrewRegistryEntry>(
    entries.map((entry) => [entry.resolvedCrew.crew.id, entry]),
  );
  return {
    resolve: Effect.fn("CrewRegistry.resolve")(function* (crewId) {
      return entriesById.get(crewId);
    }),
    listCrewIds: Effect.succeed(Array.from(entriesById.keys())),
  };
};

export const makeHydrated = (input: {
  readonly getCrews: Effect.Effect<ReadonlyArray<CrewRegistryEntry["resolvedCrew"]["crew"]>>;
  readonly getProviders: Effect.Effect<ReadonlyArray<ServerProvider>>;
}): CrewRegistryShape => {
  const listCrewIds = input.getCrews.pipe(Effect.map((crews) => crews.map((crew) => crew.id)));

  return {
    resolve: Effect.fn("CrewRegistry.resolve")(function* (crewId) {
      const [crews, providers] = yield* Effect.all([input.getCrews, input.getProviders]);
      const crew = crews.find((candidate) => candidate.id === crewId);
      if (!crew) return undefined;

      const providersById = new Map<ProviderInstanceId, ServerProvider>(
        providers.map((provider) => [provider.instanceId, provider]),
      );
      const planner = providersById.get(crew.planner.instanceId);
      const plannerAvailable = planner !== undefined && isReady(planner);
      const availableMemberIds = crew.members
        .map((member) => member.instanceId)
        .filter((instanceId) => {
          const provider = providersById.get(instanceId);
          return provider !== undefined && isReady(provider);
        });
      const memberDisplayNames = new Map<ProviderInstanceId, string>();
      for (const member of crew.members) {
        const provider = providersById.get(member.instanceId);
        if (provider) memberDisplayNames.set(member.instanceId, displayName(provider));
      }

      const unavailableReason = !planner
        ? "planner-instance-missing"
        : !plannerAvailable
          ? "planner-instance-unavailable"
          : availableMemberIds.length === 0
            ? "no-available-members"
            : undefined;

      return {
        resolvedCrew: {
          crew,
          plannerAvailable,
          availableMemberIds,
          ...(unavailableReason ? { unavailableReason } : {}),
        },
        memberDisplayNames,
      };
    }),
    listCrewIds,
  };
};

export const CrewRegistryLive = Layer.effect(
  CrewRegistry,
  Effect.gen(function* () {
    const serverSettings = yield* ServerSettingsService;
    const providerRegistry = yield* ProviderRegistry;
    return makeHydrated({
      getCrews: serverSettings.getSettings.pipe(
        Effect.map((settings) => settings.crews),
        Effect.orDie,
      ),
      getProviders: providerRegistry.getProviders,
    });
  }),
);

# Crew registry live wiring fix

Date: 2026-08-14
Branch: `build/crew-suite`

## Result

Crew turns now use the same hydrated registry as the crew picker and crew test-flight RPC.
The registry reads the current `ServerSettings.crews` value for every turn.
A crew created through `crew.create` is available to the next turn without a restart.

## Actual root cause

`CrewRegistryLive` already had the correct data source. Its `getCrews` effect calls
`ServerSettingsService.getSettings` and reads `settings.crews` each time the registry resolves a
crew. It did not cache the crew list, and it did not read a different home directory.

The fault was the layer graph in `server.ts`:

1. `CrewRegistry` was a `Context.Reference` with a default implementation that always returned
   `undefined`.
2. `ReactorLayerLive` built `CrewRegistryLive` and `ProviderCommandReactorLive` as sibling layers.
3. That sibling order exposed the hydrated registry to RPC routes. It did not provide the registry
   to the provider reactor while the reactor layer was being built.
4. Because the service had a default, Effect did not report a missing dependency. The provider
   reactor captured the default empty registry.

This explains the split field evidence. The crew picker and test-flight RPC received the exposed,
hydrated registry. The provider reactor received the empty default and reported `crew-not-found`.

## Fix

- `CrewRegistry` is now a required `Context.Service`. A missing registry is a layer error instead of
  a silent empty result.
- `CrewProviderCommandLayerLive` explicitly provides `CrewRegistryLive` while building
  `ProviderCommandReactorLive`. It also exposes that same registry for the RPC routes.
- `CrewRegistry.resolve` still runs the live settings and provider effects for each turn. There is
  no crew cache or restart requirement.
- The runtime warning still allows the turn to continue without crew tools. Its debug detail now
  includes `knownCrewIds`, which lists every crew id visible to the registry at warning time.

## Test gap closed

The earlier provider-reactor tests supplied a static in-memory registry. They proved crew behavior
after resolution, but they did not test the production layer graph.

The new server integration test imports the exact composed layer used by `server.ts`. It uses the
real orchestration engine, settings service, provider reactor, and WebSocket command route. It proves:

1. A crew present in settings when the runtime starts reaches the provider turn with its `crewId`
   and shared crew briefing.
2. A second crew created through the `crew.create` WebSocket RPC reaches the immediately following
   provider turn with its `crewId` and shared crew briefing.

The warning unit test also proves that an unknown crew reports the visible `knownCrewIds` list.

## Verification

- Requested tests plus the new registry unit coverage: 5 files, 215 tests passed.
- `apps/server/src/server.test.ts`: passed.
- `apps/server/src/orchestration/Layers/ProviderCommandReactor.test.ts`: passed.
- `apps/server/src/mcp/DispatchBroker.test.ts`: passed.
- `packages/contracts/src/orchestrationCrew.test.ts`: passed.
- `apps/server/src/orchestration/Layers/CrewRegistry.test.ts`: passed.
- `pnpm exec tsgo --noEmit` in `apps/server`: passed with only existing Effect suggestions.
- `pnpm exec tsgo --noEmit` in `packages/contracts`: passed.
- Focused formatting check and `git diff --check`: passed.

No server was started against live user data. No push or pull request was made.

import { expect, it } from "@effect/vitest";
import { EnvironmentId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { McpSchema, McpServer } from "effect/unstable/ai";

import * as DispatchBroker from "../../DispatchBroker.ts";
import * as McpHttpServer from "../../McpHttpServer.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const invocation = (capabilities: McpInvocationContext.McpInvocationScope["capabilities"]) => ({
  environmentId: EnvironmentId.make("environment-orchestration-test"),
  threadId: ThreadId.make("thread-orchestration-test"),
  providerSessionId: "provider-session-orchestration-test",
  providerInstanceId: ProviderInstanceId.make("codex"),
  capabilities,
  issuedAt: 1,
});

const client = McpSchema.McpServerClient.of({
  clientId: 1,
  protocolVersion: "2025-06-18",
  initializePayload: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "orchestration-test", version: "1.0.0" },
  },
  getClient: Effect.die("unused"),
});

const TestLayer = McpHttpServer.OrchestrationToolkitRegistrationLive.pipe(
  Layer.provideMerge(McpServer.McpServer.layer),
  Layer.provide(DispatchBroker.layer),
);

it.effect("registers the orchestration toolkit with the required annotations", () =>
  Effect.gen(function* () {
    const server = yield* McpServer.McpServer;
    expect(server.tools.map(({ tool }) => tool.name)).toEqual([
      "dispatch",
      "await_dispatch",
      "list_dispatches",
    ]);

    const dispatch = server.tools.find(({ tool }) => tool.name === "dispatch")?.tool;
    expect(dispatch?.annotations?.readOnlyHint).toBe(false);
    expect(dispatch?.annotations?.idempotentHint).toBe(false);

    const listing = server.tools.find(({ tool }) => tool.name === "list_dispatches")?.tool;
    expect(listing?.annotations?.readOnlyHint).toBe(true);
    expect(listing?.annotations?.idempotentHint).toBe(true);
  }).pipe(Effect.provide(TestLayer)),
);

it.effect("rejects every orchestration call when no crew is active", () =>
  Effect.gen(function* () {
    const server = yield* McpServer.McpServer;
    const calls = [
      { name: "dispatch", arguments: { instanceId: "codex", prompt: "Build it" } },
      { name: "await_dispatch", arguments: { dispatchId: "dispatch-1" } },
      { name: "list_dispatches", arguments: {} },
    ];

    for (const call of calls) {
      const result = yield* server
        .callTool(call)
        .pipe(
          Effect.provideService(
            McpInvocationContext.McpInvocationContext,
            invocation(new Set(["preview", "orchestration"])),
          ),
          Effect.provideService(McpSchema.McpServerClient, client),
        );
      expect(result.isError).toBe(true);
      expect(result.content).toEqual([
        { type: "text", text: "No crew is active for this thread." },
      ]);
    }
  }).pipe(Effect.provide(TestLayer)),
);

it.effect("checks the orchestration capability before invoking the broker", () =>
  Effect.gen(function* () {
    const server = yield* McpServer.McpServer;
    const result = yield* server
      .callTool({ name: "list_dispatches", arguments: {} })
      .pipe(
        Effect.provideService(
          McpInvocationContext.McpInvocationContext,
          invocation(new Set(["preview"])),
        ),
        Effect.provideService(McpSchema.McpServerClient, client),
      );

    expect(result.isError).toBe(true);
    expect(result.content).toEqual([{ type: "text", text: "No crew is active for this thread." }]);
  }).pipe(Effect.provide(TestLayer)),
);

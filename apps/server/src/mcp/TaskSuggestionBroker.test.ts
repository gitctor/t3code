import { expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  EnvironmentId,
  ProviderInstanceId,
  TaskSuggestionError,
  ThreadId,
  TurnId,
  type OrchestrationCommand,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ProjectionTaskSuggestionRepository } from "../persistence/Services/ProjectionTaskSuggestions.ts";
import type { McpInvocationScope } from "./McpInvocationContext.ts";
import { MAX_PENDING_TASK_SUGGESTIONS_PER_THREAD, make } from "./TaskSuggestionBroker.ts";

const environmentId = EnvironmentId.make("environment-1");
const threadId = ThreadId.make("thread-1");
const turnId = TurnId.make("turn-1");
const instanceId = ProviderInstanceId.make("codex-main");
const scope: McpInvocationScope = {
  environmentId,
  threadId,
  providerSessionId: "session-1",
  providerInstanceId: instanceId,
  capabilities: new Set(["suggestions"]),
  issuedAt: 1,
};

const sourceThread = {
  id: threadId,
  projectId: "project-1",
  title: "Source thread",
  modelSelection: { instanceId, model: "gpt-5.6-sol" },
  runtimeMode: "full-access",
  interactionMode: "default",
  branch: "build/crew-suite",
  worktreePath: "/repo",
  latestTurn: {
    turnId,
    state: "running",
    requestedAt: "2026-08-12T12:00:00.000Z",
    startedAt: "2026-08-12T12:00:01.000Z",
    completedAt: null,
    assistantMessageId: null,
  },
  createdAt: "2026-08-12T11:00:00.000Z",
  updatedAt: "2026-08-12T12:00:01.000Z",
  archivedAt: null,
  settledOverride: null,
  settledAt: null,
  deletedAt: null,
  messages: [],
  proposedPlans: [],
  activities: [],
  checkpoints: [],
  session: {
    threadId,
    status: "running",
    providerName: null,
    providerInstanceId: instanceId,
    runtimeMode: "full-access",
    activeTurnId: turnId,
    lastError: null,
    updatedAt: "2026-08-12T12:00:01.000Z",
  },
} as const;

function brokerHarness(pendingCount: number) {
  const commands: OrchestrationCommand[] = [];
  const layer = Layer.mergeAll(
    Layer.mock(OrchestrationEngineService)({
      dispatch: (command) =>
        Effect.sync(() => {
          commands.push(command);
          return { sequence: commands.length };
        }),
    }),
    Layer.mock(ProjectionSnapshotQuery)({
      getThreadDetailById: () => Effect.succeed(Option.some(sourceThread as never)),
    }),
    Layer.mock(ProjectionTaskSuggestionRepository)({
      countPendingBySourceThread: () => Effect.succeed(pendingCount),
    }),
  );
  return { commands, layer: Layer.merge(layer, NodeServices.layer) };
}

it.effect("creates a pending suggestion from the active MCP turn", () => {
  const harness = brokerHarness(0);
  return Effect.gen(function* () {
    const broker = yield* make;
    const result = yield* broker.suggest(scope, {
      title: "Review the web cards",
      prompt: "Review the suggested-task card states and focused tests.",
      instanceId,
      model: "gpt-5.6-sol",
      effort: "high",
      concurrency: "parallel-safe",
    });

    expect(result.suggestion).toMatchObject({
      environmentId,
      sourceThreadId: threadId,
      sourceTurnId: turnId,
      status: "pending",
      concurrency: "parallel-safe",
    });
    expect(harness.commands).toHaveLength(1);
    expect(harness.commands[0]).toMatchObject({
      type: "suggestion.create",
      suggestion: result.suggestion,
    });
  }).pipe(Effect.provide(harness.layer));
});

it.effect("returns a typed error at the per-thread pending limit", () => {
  const harness = brokerHarness(MAX_PENDING_TASK_SUGGESTIONS_PER_THREAD);
  return Effect.gen(function* () {
    const broker = yield* make;
    const error = yield* broker
      .suggest(scope, {
        title: "One task too many",
        prompt: "Do not create this suggestion.",
        concurrency: "run-solo",
        soloReason: "The pending queue is full",
      })
      .pipe(Effect.flip);

    expect(error).toBeInstanceOf(TaskSuggestionError);
    expect(error.code).toBe("pending-limit-reached");
    expect(harness.commands).toEqual([]);
  }).pipe(Effect.provide(harness.layer));
});

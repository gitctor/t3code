import { expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  CrewId,
  DispatchId,
  EnvironmentId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type OrchestrationCommand,
  type OrchestrationProjectShell,
  type OrchestrationThread,
  type ServerProvider,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import { GitWorkflowService } from "../git/GitWorkflowService.ts";
import { CrewRegistry } from "../orchestration/Services/CrewRegistry.ts";
import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { RuntimeReceiptBusTest } from "../orchestration/Layers/RuntimeReceiptBus.ts";
import {
  RuntimeReceiptBus,
  type RuntimeReceiptBusShape,
} from "../orchestration/Services/RuntimeReceiptBus.ts";
import {
  ProjectionDispatchRepository,
  type ProjectionDispatch,
} from "../persistence/Services/ProjectionDispatches.ts";
import { ProjectionTurnRepository } from "../persistence/Services/ProjectionTurns.ts";
import { ProviderRegistry } from "../provider/Services/ProviderRegistry.ts";
import { makeProviderRegistryMock } from "../provider/testUtils/providerRegistryMock.ts";

import type { McpInvocationScope } from "./McpInvocationContext.ts";
import { make, type DispatchBrokerShape } from "./DispatchBroker.ts";

const now = "2026-08-11T12:00:00.000Z";
const crewId = CrewId.make("deep_build");
const projectId = ProjectId.make("project-1");
const parentThreadId = ThreadId.make("parent-thread");
const parentTurnId = TurnId.make("parent-turn");
const plannerInstanceId = ProviderInstanceId.make("planner-codex");
const childInstanceId = ProviderInstanceId.make("builder-claude");
const fallbackInstanceId = ProviderInstanceId.make("reviewer-codex");
const childDriver = ProviderDriverKind.make("claudeAgent");

const scope: McpInvocationScope = {
  environmentId: EnvironmentId.make("environment-1"),
  threadId: parentThreadId,
  providerSessionId: "planner-session",
  providerInstanceId: plannerInstanceId,
  capabilities: new Set(["orchestration"]),
  issuedAt: 1,
};

const project: OrchestrationProjectShell = {
  id: projectId,
  title: "T3 Code",
  workspaceRoot: "/repo/t3code",
  defaultModelSelection: null,
  scripts: [],
  createdAt: now,
  updatedAt: now,
};

const thread = (input: {
  readonly id: ThreadId;
  readonly branch: string;
  readonly instanceId: ProviderInstanceId;
  readonly turnId: TurnId;
}): OrchestrationThread => ({
  id: input.id,
  projectId,
  title: "Thread",
  modelSelection: { instanceId: input.instanceId, model: "model-1" },
  runtimeMode: "full-access",
  interactionMode: "default",
  branch: input.branch,
  worktreePath: `/repo/worktrees/${input.id}`,
  latestTurn: {
    turnId: input.turnId,
    state: "running",
    requestedAt: now,
    startedAt: now,
    completedAt: null,
    assistantMessageId: null,
  },
  createdAt: now,
  updatedAt: now,
  archivedAt: null,
  settledOverride: null,
  settledAt: null,
  deletedAt: null,
  messages: [],
  proposedPlans: [],
  activities: [],
  checkpoints: [],
  session: {
    threadId: input.id,
    status: "running",
    providerName: null,
    providerInstanceId: input.instanceId,
    runtimeMode: "full-access",
    activeTurnId: input.turnId,
    lastError: null,
    updatedAt: now,
  },
});

const parentThread = thread({
  id: parentThreadId,
  branch: "feature/parent",
  instanceId: plannerInstanceId,
  turnId: parentTurnId,
});

const provider = (available = true): ServerProvider => ({
  instanceId: childInstanceId,
  driver: childDriver,
  displayName: "Claude Builder",
  enabled: available,
  installed: available,
  version: "1.0.0",
  status: available ? "ready" : "disabled",
  auth: { status: available ? "authenticated" : "unauthenticated" },
  checkedAt: now,
  availability: available ? "available" : "unavailable",
  models: [
    {
      slug: "claude-opus-4-1",
      name: "Claude Opus 4.1",
      isCustom: false,
      isDefault: true,
      isLegacy: false,
      capabilities: null,
    },
  ],
  slashCommands: [],
  skills: [],
});

const dispatchRow = (
  dispatchId: DispatchId,
  status: ProjectionDispatch["status"] = "running",
  childThreadId: ThreadId | null = ThreadId.make(`child-${dispatchId}`),
): ProjectionDispatch => ({
  dispatchId,
  parentThreadId,
  parentTurnId,
  childThreadId,
  instanceId: childInstanceId,
  provider: childDriver,
  model: "claude-opus-4-1",
  role: "build",
  title: `Dispatch ${dispatchId}`,
  effort: "high",
  status,
  reason: null,
  summary: status === "completed" ? "Done" : null,
  startedAt: now,
  settledAt: status === "running" ? null : now,
});

interface HarnessOptions {
  readonly available?: boolean;
  readonly includeMember?: boolean;
  readonly initialDispatches?: ReadonlyArray<ProjectionDispatch>;
  readonly extraThreads?: ReadonlyArray<OrchestrationThread>;
}

const withHarness = <A, E>(
  options: HarnessOptions,
  test: (harness: {
    readonly broker: DispatchBrokerShape;
    readonly restartedBroker: DispatchBrokerShape;
    readonly commands: OrchestrationCommand[];
    readonly dispatches: Map<DispatchId, ProjectionDispatch>;
    readonly worktreeBases: string[];
    readonly receiptBus: RuntimeReceiptBusShape;
  }) => Effect.Effect<A, E>,
) => {
  const commands: OrchestrationCommand[] = [];
  const dispatches = new Map(
    (options.initialDispatches ?? []).map((dispatch) => [dispatch.dispatchId, dispatch]),
  );
  const threads = new Map<ThreadId, OrchestrationThread>([
    [parentThreadId, parentThread],
    ...(options.extraThreads ?? []).map((value) => [value.id, value] as const),
  ]);
  const worktreeBases: string[] = [];

  const dispatchRepository = ProjectionDispatchRepository.of({
    upsert: (row) => Effect.sync(() => void dispatches.set(row.dispatchId, row)),
    getById: ({ dispatchId }) => Effect.succeed(Option.fromNullishOr(dispatches.get(dispatchId))),
    getByChildThreadId: ({ childThreadId }) =>
      Effect.succeed(
        Option.fromNullishOr(
          [...dispatches.values()].find((dispatch) => dispatch.childThreadId === childThreadId),
        ),
      ),
    listByParentTurn: ({ parentThreadId: requestedThreadId, parentTurnId: requestedTurnId }) =>
      Effect.succeed(
        [...dispatches.values()].filter(
          (dispatch) =>
            dispatch.parentThreadId === requestedThreadId &&
            dispatch.parentTurnId === requestedTurnId,
        ),
      ),
    listUnsettledByParentThread: ({ parentThreadId: requestedThreadId }) =>
      Effect.succeed(
        [...dispatches.values()].filter(
          (dispatch) =>
            dispatch.parentThreadId === requestedThreadId && dispatch.status === "running",
        ),
      ),
    listUnsettled: Effect.succeed(
      [...dispatches.values()].filter((dispatch) => dispatch.status === "running"),
    ),
  });

  const engine = OrchestrationEngineService.of({
    readEvents: () => Stream.empty,
    streamDomainEvents: Stream.empty,
    latestSequence: Effect.succeed(0),
    dispatch: (command) =>
      Effect.sync(() => {
        commands.push(command);
        if (command.type === "thread.dispatch.upsert") {
          const value = command.dispatch;
          dispatches.set(value.dispatchId, {
            dispatchId: value.dispatchId,
            parentThreadId: value.parentThreadId,
            parentTurnId: value.parentTurnId,
            childThreadId: value.childThreadId ?? null,
            instanceId: value.instanceId,
            provider: command.provider,
            model: value.model ?? null,
            role: value.role ?? null,
            title: command.title,
            effort: command.effort ?? null,
            status: value.status,
            reason: value.reason ?? null,
            summary: command.summary ?? null,
            startedAt: value.startedAt,
            settledAt: value.settledAt ?? null,
          });
        }
        if (command.type === "thread.create") {
          expect(command.parentThreadId).toBe(parentThreadId);
          threads.set(
            command.threadId,
            thread({
              id: command.threadId,
              branch: command.branch ?? "missing-branch",
              instanceId: command.modelSelection.instanceId,
              turnId: TurnId.make(`turn-${command.threadId}`),
            }),
          );
        }
        return { sequence: commands.length };
      }),
  });

  const layers = Layer.mergeAll(
    Layer.succeed(ProjectionDispatchRepository, dispatchRepository),
    Layer.mock(ProjectionTurnRepository)({
      getByTurnId: ({ threadId: requestedThreadId, turnId }) =>
        Effect.succeed(
          requestedThreadId === parentThreadId && turnId === parentTurnId
            ? Option.some({
                threadId: parentThreadId,
                turnId: parentTurnId,
                pendingMessageId: null,
                crewId,
                sourceProposedPlanThreadId: null,
                sourceProposedPlanId: null,
                assistantMessageId: null,
                state: "running" as const,
                requestedAt: now,
                startedAt: now,
                completedAt: null,
                checkpointTurnCount: null,
                checkpointRef: null,
                checkpointStatus: null,
                checkpointFiles: [],
              })
            : Option.none(),
        ),
    }),
    Layer.mock(ProjectionSnapshotQuery)({
      getThreadDetailById: (threadId) =>
        Effect.succeed(Option.fromNullishOr(threads.get(threadId))),
      getProjectShellById: (requestedProjectId) =>
        Effect.succeed(requestedProjectId === projectId ? Option.some(project) : Option.none()),
    }),
    Layer.succeed(
      CrewRegistry,
      CrewRegistry.of({
        resolve: (requestedCrewId) =>
          Effect.succeed(
            requestedCrewId === crewId
              ? {
                  resolvedCrew: {
                    crew: {
                      id: crewId,
                      name: "Deep Build",
                      planner: { instanceId: plannerInstanceId, model: "gpt-5.6-sol" },
                      members:
                        options.includeMember === false
                          ? []
                          : [
                              {
                                instanceId: childInstanceId,
                                model: "claude-opus-4-1",
                                role: "build",
                                options: [{ id: "effort", value: "high" }],
                              },
                              ...(options.available === false
                                ? [{ instanceId: fallbackInstanceId, role: "review" } as const]
                                : []),
                            ],
                    },
                    plannerAvailable: true,
                    availableMemberIds:
                      options.available === false ? [fallbackInstanceId] : [childInstanceId],
                  },
                  memberDisplayNames: new Map([[childInstanceId, "Claude Builder"]]),
                }
              : undefined,
          ),
      }),
    ),
    Layer.succeed(OrchestrationEngineService, engine),
    Layer.succeed(
      ProviderRegistry,
      ProviderRegistry.of(makeProviderRegistryMock([provider(options.available !== false)])),
    ),
    Layer.mock(GitWorkflowService)({
      createWorktree: (input) =>
        Effect.sync(() => {
          worktreeBases.push(input.refName);
          return {
            worktree: {
              path: `/repo/worktrees/${input.newRefName}`,
              refName: input.newRefName ?? input.refName,
            },
          };
        }),
      removeWorktree: () => Effect.void,
    }),
    RuntimeReceiptBusTest,
    NodeServices.layer,
  );

  return Effect.gen(function* () {
    const broker = yield* make;
    const restartedBroker = yield* make;
    const receiptBus = yield* RuntimeReceiptBus;
    return yield* test({
      broker,
      restartedBroker,
      commands,
      dispatches,
      worktreeBases,
      receiptBus,
    });
  }).pipe(Effect.provide(layers));
};

it.effect("accepts a rostered dispatch into an ordinary child thread and worktree", () =>
  withHarness({}, ({ broker, commands, dispatches, worktreeBases }) =>
    Effect.gen(function* () {
      const accepted = yield* broker.dispatch(scope, {
        instanceId: childInstanceId,
        prompt: "Implement the persisted dispatch projection.",
      });

      expect(accepted.status).toBe("running");
      expect(worktreeBases).toEqual(["feature/parent"]);
      const row = dispatches.get(accepted.dispatchId);
      expect(row?.childThreadId).not.toBeNull();
      expect(row?.instanceId).toBe(childInstanceId);
      expect(commands.map((command) => command.type)).toEqual([
        "thread.create",
        "thread.dispatch.upsert",
        "thread.activity.append",
        "thread.turn.start",
      ]);
      const started = commands[2];
      expect(started?.type).toBe("thread.activity.append");
      if (started?.type === "thread.activity.append") {
        expect(started.activity.kind).toBe("task.started");
      }
    }),
  ),
);

it.effect("declines an unavailable member without creating a child thread", () =>
  withHarness({ available: false }, ({ broker, commands, dispatches }) =>
    Effect.gen(function* () {
      const failure = yield* Effect.flip(
        broker.dispatch(scope, { instanceId: childInstanceId, prompt: "Build it." }),
      );
      expect(failure.code).toBe("instance-unavailable");
      expect(commands.some((command) => command.type === "thread.create")).toBe(false);
      const [declined] = [...dispatches.values()];
      expect(declined?.status).toBe("declined");
      expect(declined?.childThreadId).toBeNull();
      expect(commands.filter((command) => command.type === "thread.activity.append")).toHaveLength(
        2,
      );
    }),
  ),
);

it.effect("rejects an instance outside the crew roster", () =>
  withHarness({ includeMember: false }, ({ broker, commands }) =>
    Effect.gen(function* () {
      const failure = yield* Effect.flip(
        broker.dispatch(scope, { instanceId: childInstanceId, prompt: "Build it." }),
      );
      expect(failure.code).toBe("instance-not-in-crew");
      expect(commands).toEqual([]);
    }),
  ),
);

it.effect("enforces the four-dispatch concurrency limit", () =>
  withHarness(
    {
      initialDispatches: [1, 2, 3, 4].map((index) =>
        dispatchRow(DispatchId.make(`running-${index}`)),
      ),
    },
    ({ broker, commands }) =>
      Effect.gen(function* () {
        const failure = yield* Effect.flip(
          broker.dispatch(scope, { instanceId: childInstanceId, prompt: "One more." }),
        );
        expect(failure.code).toBe("dispatch-limit-reached");
        expect(commands).toEqual([]);
      }),
  ),
);

it.effect("chains a child worktree from a completed dispatch child branch", () => {
  const priorDispatchId = DispatchId.make("completed-dispatch");
  const priorChildId = ThreadId.make("completed-child");
  return withHarness(
    {
      initialDispatches: [dispatchRow(priorDispatchId, "completed", priorChildId)],
      extraThreads: [
        thread({
          id: priorChildId,
          branch: "t3code/dispatch-prior",
          instanceId: childInstanceId,
          turnId: TurnId.make("prior-turn"),
        }),
      ],
    },
    ({ broker, worktreeBases }) =>
      Effect.gen(function* () {
        yield* broker.dispatch(scope, {
          instanceId: childInstanceId,
          prompt: "Continue the prior implementation.",
          fromDispatchId: priorDispatchId,
        });
        expect(worktreeBases).toEqual(["t3code/dispatch-prior"]);
      }),
  );
});

it.effect("returns running when await_dispatch reaches its timeout", () =>
  withHarness(
    { initialDispatches: [dispatchRow(DispatchId.make("running-dispatch"))] },
    ({ broker }) =>
      Effect.gen(function* () {
        const waiting = yield* broker
          .awaitDispatch(scope, {
            dispatchId: DispatchId.make("running-dispatch"),
            timeoutSeconds: 1,
          })
          .pipe(Effect.forkChild);
        yield* TestClock.adjust("1 second");
        expect(yield* Fiber.join(waiting)).toEqual({
          dispatchId: DispatchId.make("running-dispatch"),
          status: "running",
        });
      }),
  ),
);

it.effect("settles await_dispatch from a lifecycle receipt without polling", () => {
  const dispatchId = DispatchId.make("awaited-dispatch");
  return withHarness(
    { initialDispatches: [dispatchRow(dispatchId)] },
    ({ broker, dispatches, receiptBus }) =>
      Effect.gen(function* () {
        const waiting = yield* broker.awaitDispatch(scope, { dispatchId }).pipe(Effect.forkChild);
        yield* Effect.yieldNow;
        const completed = dispatchRow(dispatchId, "completed");
        dispatches.set(dispatchId, completed);
        yield* receiptBus.publish({
          type: "dispatch.lifecycle",
          dispatchId,
          parentThreadId,
          parentTurnId,
          ...(completed.childThreadId !== null ? { childThreadId: completed.childThreadId } : {}),
          status: "completed",
          summary: "Done",
          createdAt: now,
        });

        expect(yield* Fiber.join(waiting)).toEqual({
          dispatchId,
          status: "completed",
          summary: "Done",
        });
      }),
  );
});

it.effect("reads projected dispatch state after the broker is recreated", () =>
  withHarness(
    { initialDispatches: [dispatchRow(DispatchId.make("persisted-dispatch"), "completed")] },
    ({ restartedBroker }) =>
      Effect.gen(function* () {
        const listing = yield* restartedBroker.listDispatches(scope);
        expect(listing.dispatches).toHaveLength(1);
        expect(listing.dispatches[0]?.dispatchId).toBe(DispatchId.make("persisted-dispatch"));
        expect(listing.dispatches[0]?.status).toBe("completed");
      }),
  ),
);

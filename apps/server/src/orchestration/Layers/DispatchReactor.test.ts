import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import {
  CommandId,
  CorrelationId,
  DispatchId,
  EventId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type OrchestrationCommand,
  type OrchestrationEvent,
  type OrchestrationThread,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";

import {
  ProjectionDispatchRepository,
  type ProjectionDispatch,
} from "../../persistence/Services/ProjectionDispatches.ts";
import { ProjectionTurnRepository } from "../../persistence/Services/ProjectionTurns.ts";
import { DispatchReactor } from "../Services/DispatchReactor.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import { RuntimeReceiptBusTest } from "./RuntimeReceiptBus.ts";
import { DispatchReactorLive } from "./DispatchReactor.ts";

const now = "2026-08-11T12:00:00.000Z";
const parentThreadId = ThreadId.make("parent-thread");
const parentTurnId = TurnId.make("parent-turn");
const childThreadId = ThreadId.make("child-thread");
const childTurnId = TurnId.make("child-turn");
const instanceId = ProviderInstanceId.make("claude-builder");

const childThread: OrchestrationThread = {
  id: childThreadId,
  projectId: ProjectId.make("project-1"),
  title: "Child",
  modelSelection: { instanceId, model: "claude-opus-4-1" },
  runtimeMode: "full-access",
  interactionMode: "default",
  branch: "t3code/dispatch-child",
  worktreePath: "/repo/worktrees/child",
  latestTurn: {
    turnId: childTurnId,
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
    threadId: childThreadId,
    status: "running",
    providerName: "claudeAgent",
    providerInstanceId: instanceId,
    runtimeMode: "full-access",
    activeTurnId: childTurnId,
    lastError: null,
    updatedAt: now,
  },
};

const runningDispatch: ProjectionDispatch = {
  dispatchId: DispatchId.make("dispatch-1"),
  parentThreadId,
  parentTurnId,
  childThreadId,
  instanceId,
  provider: ProviderDriverKind.make("claudeAgent"),
  model: "claude-opus-4-1",
  role: "build",
  title: "Build the projection",
  effort: "high",
  status: "running",
  reason: null,
  summary: null,
  startedAt: now,
  settledAt: null,
};

const interruptEvent: OrchestrationEvent = {
  sequence: 1,
  eventId: EventId.make("event-parent-interrupt"),
  aggregateKind: "thread",
  aggregateId: parentThreadId,
  occurredAt: now,
  commandId: CommandId.make("command-parent-interrupt"),
  causationEventId: null,
  correlationId: CorrelationId.make("command-parent-interrupt"),
  metadata: {},
  type: "thread.turn-interrupt-requested",
  payload: {
    threadId: parentThreadId,
    turnId: parentTurnId,
    createdAt: now,
  },
};

const completionEvent: OrchestrationEvent = {
  sequence: 2,
  eventId: EventId.make("event-parent-completed"),
  aggregateKind: "thread",
  aggregateId: parentThreadId,
  occurredAt: now,
  commandId: CommandId.make("command-parent-completed"),
  causationEventId: null,
  correlationId: CorrelationId.make("command-parent-completed"),
  metadata: {},
  type: "thread.session-set",
  payload: {
    threadId: parentThreadId,
    session: {
      threadId: parentThreadId,
      status: "ready",
      providerName: "codex",
      runtimeMode: "full-access",
      activeTurnId: null,
      lastError: null,
      updatedAt: now,
    },
  },
};

it.effect("cancels live children on parent interruption and warns on parent completion", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const domainEvents = yield* PubSub.unbounded<OrchestrationEvent>();
      const commands: OrchestrationCommand[] = [];
      const dispatches = new Map([[runningDispatch.dispatchId, runningDispatch]]);
      let parentTurnState: "running" | "completed" = "running";

      const dispatchRepository = ProjectionDispatchRepository.of({
        upsert: (row) => Effect.sync(() => void dispatches.set(row.dispatchId, row)),
        getById: ({ dispatchId }) =>
          Effect.sync(() => Option.fromNullishOr(dispatches.get(dispatchId))),
        getByChildThreadId: ({ childThreadId: requestedChildThreadId }) =>
          Effect.sync(() =>
            Option.fromNullishOr(
              [...dispatches.values()].find(
                (dispatch) => dispatch.childThreadId === requestedChildThreadId,
              ),
            ),
          ),
        listByParentTurn: () => Effect.sync(() => [...dispatches.values()]),
        listUnsettledByParentThread: ({ parentThreadId: requestedParentThreadId }) =>
          Effect.sync(() =>
            [...dispatches.values()].filter(
              (dispatch) =>
                dispatch.parentThreadId === requestedParentThreadId &&
                (dispatch.status === "queued" || dispatch.status === "running"),
            ),
          ),
        listUnsettled: Effect.sync(() =>
          [...dispatches.values()].filter(
            (dispatch) => dispatch.status === "queued" || dispatch.status === "running",
          ),
        ),
      });

      const engine = OrchestrationEngineService.of({
        readEvents: () => Stream.empty,
        streamDomainEvents: Stream.fromPubSub(domainEvents),
        latestSequence: Effect.succeed(0),
        dispatch: (command) =>
          Effect.sync(() => {
            commands.push(command);
            if (command.type === "thread.dispatch.upsert") {
              const dispatch = dispatches.get(command.dispatch.dispatchId);
              if (dispatch) {
                dispatches.set(command.dispatch.dispatchId, {
                  ...dispatch,
                  status: command.dispatch.status,
                  reason: command.dispatch.reason ?? null,
                  summary: command.summary ?? null,
                  settledAt: command.dispatch.settledAt ?? null,
                });
              }
            }
            return { sequence: commands.length };
          }),
      });

      const layer = DispatchReactorLive.pipe(
        Layer.provideMerge(Layer.succeed(ProjectionDispatchRepository, dispatchRepository)),
        Layer.provideMerge(
          Layer.mock(ProjectionTurnRepository)({
            getByTurnId: () =>
              Effect.succeed(
                Option.some({
                  threadId: parentThreadId,
                  turnId: parentTurnId,
                  pendingMessageId: null,
                  crewId: null,
                  sourceProposedPlanThreadId: null,
                  sourceProposedPlanId: null,
                  assistantMessageId: null,
                  state: parentTurnState,
                  requestedAt: now,
                  startedAt: now,
                  completedAt: null,
                  checkpointTurnCount: null,
                  checkpointRef: null,
                  checkpointStatus: null,
                  checkpointFiles: [],
                }),
              ),
          }),
        ),
        Layer.provideMerge(
          Layer.mock(ProjectionSnapshotQuery)({
            getThreadDetailById: (threadId) =>
              Effect.succeed(threadId === childThreadId ? Option.some(childThread) : Option.none()),
          }),
        ),
        Layer.provideMerge(Layer.succeed(OrchestrationEngineService, engine)),
        Layer.provideMerge(RuntimeReceiptBusTest),
        Layer.provideMerge(NodeServices.layer),
      );

      yield* Effect.gen(function* () {
        const reactor = yield* DispatchReactor;
        yield* reactor.start();
        yield* reactor.drain;
        yield* Effect.yieldNow;
        yield* PubSub.publish(domainEvents, interruptEvent);
        yield* Effect.yieldNow;
        yield* reactor.drain;

        expect(dispatches.get(runningDispatch.dispatchId)?.status).toBe("cancelled");
        expect(commands.map((command) => command.type)).toEqual([
          "thread.turn.interrupt",
          "thread.dispatch.upsert",
          "thread.activity.append",
        ]);
        const completed = commands[2];
        expect(completed?.type).toBe("thread.activity.append");
        if (completed?.type === "thread.activity.append") {
          expect(completed.activity.kind).toBe("task.completed");
          expect(completed.activity.payload).toMatchObject({
            taskId: runningDispatch.dispatchId,
            status: "stopped",
            instanceId,
            childThreadId,
          });
        }

        commands.length = 0;
        dispatches.set(runningDispatch.dispatchId, runningDispatch);
        parentTurnState = "completed";
        yield* PubSub.publish(domainEvents, completionEvent);
        yield* Effect.yieldNow;
        yield* reactor.drain;

        expect(commands.map((command) => command.type)).toEqual([
          "thread.message.system.append",
          "thread.turn.interrupt",
          "thread.dispatch.upsert",
          "thread.activity.append",
        ]);
        const warning = commands[0];
        expect(warning?.type).toBe("thread.message.system.append");
        if (warning?.type === "thread.message.system.append") {
          expect(warning.text).toBe(
            "Turn ended with 1 agents still working. Their results were not collected.",
          );
        }
      }).pipe(Effect.provide(layer));
    }),
  ),
);

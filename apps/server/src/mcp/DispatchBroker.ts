import {
  CommandId,
  DispatchId,
  EventId,
  isProviderAvailable,
  isRunnableCrew,
  isSettledDispatchStatus,
  MessageId,
  OrchestrationError,
  ProviderDriverKind,
  ThreadId,
  TurnId,
  type AwaitDispatchInput,
  type DispatchAccepted,
  type DispatchInput,
  type DispatchListing,
  type DispatchOutcome,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Semaphore from "effect/Semaphore";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import { GitWorkflowService } from "../git/GitWorkflowService.ts";
import { runtimeEventToActivities } from "../orchestration/Layers/ProviderRuntimeIngestion.ts";
import { CrewRegistry } from "../orchestration/Services/CrewRegistry.ts";
import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { RuntimeReceiptBus } from "../orchestration/Services/RuntimeReceiptBus.ts";
import { makeDispatchTaskRuntimeEvent } from "../orchestration/DispatchTaskProjection.ts";
import { ProjectionDispatchRepository } from "../persistence/Services/ProjectionDispatches.ts";
import type { ProjectionDispatch } from "../persistence/Services/ProjectionDispatches.ts";
import { ProjectionTurnRepository } from "../persistence/Services/ProjectionTurns.ts";
import { ProviderRegistry } from "../provider/Services/ProviderRegistry.ts";

import type { McpInvocationScope } from "./McpInvocationContext.ts";

const DISPATCH_CONCURRENCY_LIMIT = 4;
const isOrchestrationError = Schema.is(OrchestrationError);

export interface DispatchBrokerShape {
  readonly dispatch: (
    scope: McpInvocationScope,
    input: DispatchInput,
  ) => Effect.Effect<DispatchAccepted, OrchestrationError>;
  readonly awaitDispatch: (
    scope: McpInvocationScope,
    input: AwaitDispatchInput,
  ) => Effect.Effect<DispatchOutcome, OrchestrationError>;
  readonly listDispatches: (
    scope: McpInvocationScope,
  ) => Effect.Effect<DispatchListing, OrchestrationError>;
}

export class DispatchBroker extends Context.Service<DispatchBroker, DispatchBrokerShape>()(
  "t3/mcp/DispatchBroker",
) {}

const orchestrationError = (
  code: OrchestrationError["code"],
  message: string,
): OrchestrationError => new OrchestrationError({ code, message });

const unavailable = () =>
  orchestrationError("not-orchestrating", "No crew is active for this thread.");

const dispatchTitle = (prompt: string, fallback: string): string => {
  const firstLine = prompt
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  return (firstLine ?? fallback).slice(0, 120);
};

const effortFromOptions = (
  options: ReadonlyArray<{ readonly id: string; readonly value: string | boolean }> | undefined,
): string | undefined => {
  const value = options?.find((option) => option.id === "effort")?.value;
  return typeof value === "string" ? value : undefined;
};

export const make = Effect.gen(function* () {
  const crypto = yield* Crypto.Crypto;
  const crewRegistry = yield* CrewRegistry;
  const dispatchRepository = yield* ProjectionDispatchRepository;
  const turnRepository = yield* ProjectionTurnRepository;
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
  const orchestrationEngine = yield* OrchestrationEngineService;
  const providerRegistry = yield* ProviderRegistry;
  const gitWorkflow = yield* GitWorkflowService;
  const receiptBus = yield* RuntimeReceiptBus;
  const dispatchSemaphore = yield* Semaphore.make(1);

  const nowIso = Effect.map(DateTime.now, DateTime.formatIso);
  const randomUuid = crypto.randomUUIDv4;
  const commandId = (tag: string) =>
    randomUuid.pipe(Effect.map((uuid) => CommandId.make(`server:dispatch:${tag}:${uuid}`)));
  const eventId = randomUuid.pipe(Effect.map(EventId.make));

  const mapInternalFailure = (message: string) =>
    Effect.mapError(() => orchestrationError("instance-unavailable", message));

  const resolvePlannerContext = Effect.fn("DispatchBroker.resolvePlannerContext")(function* (
    scope: McpInvocationScope,
  ) {
    const thread = yield* projectionSnapshotQuery
      .getThreadDetailById(scope.threadId)
      .pipe(
        mapInternalFailure("The planner thread state is unavailable."),
        Effect.map(Option.getOrUndefined),
      );
    const turnId = thread?.session?.activeTurnId;
    if (
      !thread ||
      thread.session?.status !== "running" ||
      turnId === null ||
      turnId === undefined ||
      (thread.session.providerInstanceId !== undefined &&
        thread.session.providerInstanceId !== scope.providerInstanceId)
    ) {
      return yield* unavailable();
    }
    const turn = yield* turnRepository
      .getByTurnId({ threadId: scope.threadId, turnId })
      .pipe(
        mapInternalFailure("The planner turn state is unavailable."),
        Effect.map(Option.getOrUndefined),
      );
    if (!turn?.crewId || turn.state !== "running") {
      return yield* unavailable();
    }
    const crewEntry = yield* crewRegistry.resolve(turn.crewId);
    if (!crewEntry || !isRunnableCrew(crewEntry.resolvedCrew)) {
      return yield* unavailable();
    }
    return { thread, turn, turnId, crewEntry } as const;
  });

  const upsertDispatch = Effect.fn("DispatchBroker.upsertDispatch")(function* (
    row: ProjectionDispatch,
    createdAt: string,
  ) {
    yield* orchestrationEngine
      .dispatch({
        type: "thread.dispatch.upsert",
        commandId: yield* commandId("upsert"),
        threadId: row.parentThreadId,
        dispatch: {
          dispatchId: row.dispatchId,
          parentThreadId: row.parentThreadId,
          parentTurnId: row.parentTurnId,
          ...(row.childThreadId !== null ? { childThreadId: row.childThreadId } : {}),
          instanceId: row.instanceId,
          ...(row.model !== null ? { model: row.model } : {}),
          ...(row.role !== null ? { role: row.role } : {}),
          status: row.status,
          ...(row.reason !== null ? { reason: row.reason } : {}),
          startedAt: row.startedAt,
          ...(row.settledAt !== null ? { settledAt: row.settledAt } : {}),
        },
        title: row.title,
        provider: row.provider,
        ...(row.effort !== null ? { effort: row.effort } : {}),
        ...(row.summary !== null ? { summary: row.summary } : {}),
        createdAt,
      })
      .pipe(mapInternalFailure("The dispatch state could not be saved."));
  });

  const appendTaskProjection = Effect.fn("DispatchBroker.appendTaskProjection")(function* (
    row: ProjectionDispatch,
    projection: Parameters<typeof makeDispatchTaskRuntimeEvent>[0]["projection"],
    createdAt: string,
  ) {
    const runtimeEvent = makeDispatchTaskRuntimeEvent({
      dispatch: row,
      eventId: yield* eventId,
      createdAt,
      projection,
    });
    const activities = runtimeEventToActivities(runtimeEvent, row.title);
    yield* Effect.forEach(
      activities,
      (activity) =>
        commandId("task-activity").pipe(
          Effect.flatMap((nextCommandId) =>
            orchestrationEngine.dispatch({
              type: "thread.activity.append",
              commandId: nextCommandId,
              threadId: row.parentThreadId,
              activity,
              createdAt,
            }),
          ),
        ),
      { concurrency: 1 },
    ).pipe(Effect.asVoid, mapInternalFailure("The dispatch task row could not be projected."));
  });

  const publishReceipt = (row: ProjectionDispatch) =>
    receiptBus.publish({
      type: "dispatch.lifecycle",
      dispatchId: row.dispatchId,
      parentThreadId: row.parentThreadId,
      parentTurnId: row.parentTurnId,
      ...(row.childThreadId !== null ? { childThreadId: row.childThreadId } : {}),
      status: row.status,
      ...(row.summary !== null ? { summary: row.summary } : {}),
      ...(row.reason !== null ? { reason: row.reason } : {}),
      createdAt: row.settledAt ?? row.startedAt,
    });

  const persistDecline = Effect.fn("DispatchBroker.persistDecline")(function* (input: {
    readonly dispatchId: DispatchId;
    readonly parentThreadId: ThreadId;
    readonly parentTurnId: TurnId;
    readonly instanceId: DispatchInput["instanceId"];
    readonly provider: ProviderDriverKind;
    readonly model: string | undefined;
    readonly role: string | undefined;
    readonly title: string;
    readonly effort: string | undefined;
    readonly reason: string;
    readonly startedAt: string;
  }) {
    const row = {
      dispatchId: input.dispatchId,
      parentThreadId: input.parentThreadId,
      parentTurnId: input.parentTurnId,
      childThreadId: null,
      instanceId: input.instanceId,
      provider: input.provider,
      model: input.model ?? null,
      role: input.role ?? null,
      title: input.title,
      effort: input.effort ?? null,
      status: "declined" as const,
      reason: input.reason,
      summary: null,
      startedAt: input.startedAt,
      settledAt: input.startedAt,
    };
    yield* upsertDispatch(row, input.startedAt);
    yield* appendTaskProjection(row, { kind: "started" }, input.startedAt);
    yield* appendTaskProjection(
      row,
      { kind: "completed", status: "failed", summary: input.reason },
      input.startedAt,
    );
    yield* publishReceipt(row);
  });

  const persistFailedStart = Effect.fn("DispatchBroker.persistFailedStart")(function* (
    row: ProjectionDispatch,
    reason: string,
    settledAt: string,
  ) {
    const failed: ProjectionDispatch = {
      ...row,
      status: "failed",
      reason,
      settledAt,
    };
    yield* upsertDispatch(failed, settledAt);
    yield* appendTaskProjection(
      failed,
      { kind: "completed", status: "failed", summary: reason },
      settledAt,
    );
    yield* publishReceipt(failed);
  });

  const dispatchUnlocked = Effect.fn("DispatchBroker.dispatchUnlocked")(function* (
    scope: McpInvocationScope,
    input: DispatchInput,
  ) {
    const planner = yield* resolvePlannerContext(scope);
    const member = planner.crewEntry.resolvedCrew.crew.members.find(
      (candidate) => candidate.instanceId === input.instanceId,
    );
    if (!member) {
      return yield* orchestrationError(
        "instance-not-in-crew",
        `Provider instance '${input.instanceId}' is not in this crew.`,
      );
    }

    const existing = yield* dispatchRepository
      .listByParentTurn({ parentThreadId: scope.threadId, parentTurnId: planner.turnId })
      .pipe(mapInternalFailure("Dispatch state is unavailable."));
    if (
      existing.filter((dispatch) => !isSettledDispatchStatus(dispatch.status)).length >=
      DISPATCH_CONCURRENCY_LIMIT
    ) {
      return yield* orchestrationError(
        "dispatch-limit-reached",
        `This turn already has ${DISPATCH_CONCURRENCY_LIMIT} active dispatches.`,
      );
    }

    let baseThread = planner.thread;
    if (input.fromDispatchId !== undefined) {
      const dependency = yield* dispatchRepository
        .getById({ dispatchId: input.fromDispatchId })
        .pipe(
          mapInternalFailure("Dispatch state is unavailable."),
          Effect.map(Option.getOrUndefined),
        );
      if (
        !dependency ||
        dependency.parentThreadId !== scope.threadId ||
        dependency.parentTurnId !== planner.turnId ||
        dependency.status !== "completed" ||
        dependency.childThreadId === null
      ) {
        return yield* orchestrationError(
          "dispatch-not-found",
          `Completed dispatch '${input.fromDispatchId}' was not found for this turn.`,
        );
      }
      const chainedThread = yield* projectionSnapshotQuery
        .getThreadDetailById(dependency.childThreadId)
        .pipe(
          mapInternalFailure("The chained child thread is unavailable."),
          Effect.map(Option.getOrUndefined),
        );
      if (!chainedThread) {
        return yield* orchestrationError(
          "dispatch-not-found",
          `Completed dispatch '${input.fromDispatchId}' has no child thread.`,
        );
      }
      baseThread = chainedThread;
    }

    const providers = yield* providerRegistry.getProviders;
    const provider = providers.find((candidate) => candidate.instanceId === input.instanceId);
    const targetAvailable =
      planner.crewEntry.resolvedCrew.availableMemberIds.includes(input.instanceId) &&
      provider !== undefined &&
      isProviderAvailable(provider) &&
      provider.enabled &&
      provider.installed &&
      provider.status === "ready" &&
      provider.auth.status !== "unauthenticated";
    const model =
      input.model ??
      member.model ??
      provider?.models.find((entry) => entry.isDefault)?.slug ??
      provider?.models[0]?.slug;
    const role = input.role ?? member.role;
    const effort = effortFromOptions(member.options);
    const title = dispatchTitle(
      input.prompt,
      planner.crewEntry.memberDisplayNames.get(input.instanceId) ?? String(input.instanceId),
    );
    const startedAt = yield* nowIso;
    const dispatchId = DispatchId.make(yield* randomUuid);

    if (!targetAvailable || !model || !provider) {
      const reason = `Provider instance '${input.instanceId}' is unavailable.`;
      yield* persistDecline({
        dispatchId,
        parentThreadId: scope.threadId,
        parentTurnId: planner.turnId,
        instanceId: input.instanceId,
        provider: provider?.driver ?? ProviderDriverKind.make("unknown"),
        model,
        role,
        title,
        effort,
        reason,
        startedAt,
      });
      return yield* orchestrationError("instance-unavailable", reason);
    }

    const project = yield* projectionSnapshotQuery
      .getProjectShellById(planner.thread.projectId)
      .pipe(
        mapInternalFailure("The planner project is unavailable."),
        Effect.map(Option.getOrUndefined),
      );
    const baseBranch = baseThread.branch;
    if (!project || !baseBranch) {
      const reason = "The parent thread has no current branch for a child worktree.";
      yield* persistDecline({
        dispatchId,
        parentThreadId: scope.threadId,
        parentTurnId: planner.turnId,
        instanceId: input.instanceId,
        provider: provider.driver,
        model,
        role,
        title,
        effort,
        reason,
        startedAt,
      });
      return yield* orchestrationError("instance-unavailable", reason);
    }

    const childThreadId = ThreadId.make(yield* randomUuid);
    const childBranch = `t3code/dispatch-${String(dispatchId).slice(0, 12)}`;
    const worktree = yield* gitWorkflow
      .createWorktree({
        cwd: project.workspaceRoot,
        refName: baseBranch,
        newRefName: childBranch,
        baseRefName: baseBranch,
        path: null,
      })
      .pipe(
        Effect.mapError(() =>
          orchestrationError(
            "instance-unavailable",
            `A child worktree could not be created from branch '${baseBranch}'.`,
          ),
        ),
      );

    const row = {
      dispatchId,
      parentThreadId: scope.threadId,
      parentTurnId: planner.turnId,
      childThreadId,
      instanceId: input.instanceId,
      provider: provider.driver,
      model,
      role: role ?? null,
      title,
      effort: effort ?? null,
      status: "running" as const,
      reason: null,
      summary: null,
      startedAt,
      settledAt: null,
    };

    let childCreated = false;
    let dispatchPersisted = false;
    const startChild = Effect.gen(function* () {
      yield* orchestrationEngine.dispatch({
        type: "thread.create",
        commandId: yield* commandId("child-create"),
        threadId: childThreadId,
        projectId: planner.thread.projectId,
        title,
        modelSelection: {
          instanceId: input.instanceId,
          model,
          ...(member.options !== undefined ? { options: member.options } : {}),
        },
        runtimeMode: planner.thread.runtimeMode,
        interactionMode: "default",
        branch: worktree.worktree.refName,
        worktreePath: worktree.worktree.path,
        createdAt: startedAt,
      });
      childCreated = true;
      yield* upsertDispatch(row, startedAt);
      dispatchPersisted = true;
      yield* appendTaskProjection(row, { kind: "started" }, startedAt);
      yield* orchestrationEngine.dispatch({
        type: "thread.turn.start",
        commandId: yield* commandId("child-turn-start"),
        threadId: childThreadId,
        message: {
          messageId: MessageId.make(yield* randomUuid),
          role: "user",
          text: input.prompt,
          attachments: [],
        },
        modelSelection: {
          instanceId: input.instanceId,
          model,
          ...(member.options !== undefined ? { options: member.options } : {}),
        },
        runtimeMode: planner.thread.runtimeMode,
        interactionMode: "default",
        createdAt: startedAt,
      });
      yield* publishReceipt(row);
    });

    const startFailureReason = `Provider instance '${input.instanceId}' could not accept the child turn.`;
    yield* startChild.pipe(
      Effect.mapError(() => orchestrationError("instance-unavailable", startFailureReason)),
      Effect.catch((error) =>
        Effect.gen(function* () {
          if (dispatchPersisted) {
            yield* persistFailedStart(row, startFailureReason, startedAt).pipe(
              Effect.catch(() => Effect.void),
            );
          } else if (!childCreated) {
            yield* gitWorkflow
              .removeWorktree({
                cwd: project.workspaceRoot,
                path: worktree.worktree.path,
                force: true,
              })
              .pipe(Effect.catch(() => Effect.void));
          }
          return yield* error;
        }),
      ),
    );

    return {
      dispatchId,
      instanceId: input.instanceId,
      model,
      status: "running",
    } satisfies DispatchAccepted;
  });

  const dispatch: DispatchBrokerShape["dispatch"] = (scope, input) =>
    dispatchSemaphore
      .withPermits(1)(dispatchUnlocked(scope, input))
      .pipe(
        Effect.mapError((error) =>
          isOrchestrationError(error)
            ? error
            : orchestrationError(
                "instance-unavailable",
                "The child dispatch could not be started.",
              ),
        ),
      );

  const resolveOwnedDispatch = Effect.fn("DispatchBroker.resolveOwnedDispatch")(function* (
    scope: McpInvocationScope,
    dispatchId: DispatchId,
  ) {
    const planner = yield* resolvePlannerContext(scope);
    const dispatch = yield* dispatchRepository
      .getById({ dispatchId })
      .pipe(
        mapInternalFailure("Dispatch state is unavailable."),
        Effect.map(Option.getOrUndefined),
      );
    if (
      !dispatch ||
      dispatch.parentThreadId !== scope.threadId ||
      dispatch.parentTurnId !== planner.turnId
    ) {
      return yield* orchestrationError(
        "dispatch-not-found",
        `Dispatch '${dispatchId}' was not found for this turn.`,
      );
    }
    return dispatch;
  });

  const outcome = (dispatch: ProjectionDispatch): DispatchOutcome => ({
    dispatchId: dispatch.dispatchId,
    status: dispatch.status,
    ...(dispatch.summary !== null ? { summary: dispatch.summary } : {}),
    ...(dispatch.reason !== null ? { reason: dispatch.reason } : {}),
  });

  const awaitDispatch: DispatchBrokerShape["awaitDispatch"] = (scope, input) =>
    Effect.scoped(
      Effect.gen(function* () {
        const subscription = yield* receiptBus.subscribe;
        const initial = yield* resolveOwnedDispatch(scope, input.dispatchId);
        if (isSettledDispatchStatus(initial.status)) {
          return outcome(initial);
        }
        const settledReceipt = Stream.fromSubscription(subscription).pipe(
          Stream.filter(
            (receipt) =>
              receipt.type === "dispatch.lifecycle" &&
              receipt.dispatchId === input.dispatchId &&
              isSettledDispatchStatus(receipt.status),
          ),
          Stream.runHead,
        );
        if (input.timeoutSeconds !== undefined) {
          const waited = yield* settledReceipt.pipe(
            Effect.timeoutOption(input.timeoutSeconds * 1_000),
            Effect.map(Option.flatten),
          );
          if (Option.isNone(waited)) {
            return { dispatchId: input.dispatchId, status: "running" };
          }
        } else {
          yield* settledReceipt;
        }
        const settled = yield* resolveOwnedDispatch(scope, input.dispatchId);
        return outcome(settled);
      }),
    );

  const listDispatches: DispatchBrokerShape["listDispatches"] = Effect.fn(
    "DispatchBroker.listDispatches",
  )(function* (scope) {
    const planner = yield* resolvePlannerContext(scope);
    const dispatches = yield* dispatchRepository
      .listByParentTurn({ parentThreadId: scope.threadId, parentTurnId: planner.turnId })
      .pipe(mapInternalFailure("Dispatch state is unavailable."));
    return {
      dispatches: dispatches.map((dispatch) => ({
        dispatchId: dispatch.dispatchId,
        parentThreadId: dispatch.parentThreadId,
        parentTurnId: dispatch.parentTurnId,
        ...(dispatch.childThreadId !== null ? { childThreadId: dispatch.childThreadId } : {}),
        instanceId: dispatch.instanceId,
        ...(dispatch.model !== null ? { model: dispatch.model } : {}),
        ...(dispatch.role !== null ? { role: dispatch.role } : {}),
        status: dispatch.status,
        ...(dispatch.reason !== null ? { reason: dispatch.reason } : {}),
        startedAt: dispatch.startedAt,
        ...(dispatch.settledAt !== null ? { settledAt: dispatch.settledAt } : {}),
      })),
    } satisfies DispatchListing;
  });

  return DispatchBroker.of({ dispatch, awaitDispatch, listDispatches });
});

export const layer = Layer.effect(DispatchBroker, make);

export const unavailableLayer = Layer.succeed(
  DispatchBroker,
  DispatchBroker.of({
    dispatch: Effect.fn("DispatchBroker.unavailable.dispatch")(function* () {
      return yield* unavailable();
    }),
    awaitDispatch: Effect.fn("DispatchBroker.unavailable.awaitDispatch")(function* () {
      return yield* unavailable();
    }),
    listDispatches: Effect.fn("DispatchBroker.unavailable.listDispatches")(function* () {
      return yield* unavailable();
    }),
  }),
);

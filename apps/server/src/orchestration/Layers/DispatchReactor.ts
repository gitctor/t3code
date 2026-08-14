import {
  CommandId,
  EventId,
  isSettledDispatchStatus,
  MessageId,
  type OrchestrationEvent,
  type OrchestrationThreadActivity,
} from "@t3tools/contracts";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import * as Cause from "effect/Cause";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import type { ProjectionDispatch } from "../../persistence/Services/ProjectionDispatches.ts";
import { ProjectionDispatchRepository } from "../../persistence/Services/ProjectionDispatches.ts";
import { ProjectionTurnRepository } from "../../persistence/Services/ProjectionTurns.ts";
import { forkParked } from "../../serverActivation.ts";
import { makeDispatchTaskRuntimeEvent } from "../DispatchTaskProjection.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import {
  RuntimeReceiptBus,
  type TurnProcessingQuiescedReceipt,
} from "../Services/RuntimeReceiptBus.ts";
import { DispatchReactor, type DispatchReactorShape } from "../Services/DispatchReactor.ts";
import { runtimeEventToActivities } from "./ProviderRuntimeIngestion.ts";

type DispatchInput =
  | { readonly source: "domain"; readonly event: OrchestrationEvent }
  | { readonly source: "receipt"; readonly receipt: TurnProcessingQuiescedReceipt }
  | { readonly source: "reconcile"; readonly dispatch: ProjectionDispatch };

const PROGRESS_ACTIVITY_KINDS = new Set([
  "item.started",
  "item.updated",
  "item.completed",
  "tool.progress",
  "task.progress",
  "approval.requested",
  "approval.resolved",
  "user-input.requested",
  "user-input.resolved",
]);

const activityProgress = (
  activity: OrchestrationThreadActivity,
):
  | {
      readonly summary: string;
      readonly lastToolName?: string;
      readonly status?: "running" | "waiting";
    }
  | undefined => {
  if (!PROGRESS_ACTIVITY_KINDS.has(activity.kind)) return undefined;
  const payload =
    typeof activity.payload === "object" && activity.payload !== null
      ? (activity.payload as Record<string, unknown>)
      : {};
  const text = (key: string) =>
    typeof payload[key] === "string" && String(payload[key]).trim().length > 0
      ? String(payload[key]).trim()
      : undefined;
  const lastToolName = text("lastToolName") ?? text("toolName");
  const summary =
    text("summary") ?? text("detail") ?? text("title") ?? lastToolName ?? activity.summary;
  const waiting =
    activity.kind === "approval.requested" || activity.kind === "user-input.requested";
  const resumed = activity.kind === "approval.resolved" || activity.kind === "user-input.resolved";
  return {
    summary,
    ...(lastToolName !== undefined ? { lastToolName } : {}),
    ...(waiting ? { status: "waiting" as const } : resumed ? { status: "running" as const } : {}),
  };
};

export const make = Effect.gen(function* () {
  const crypto = yield* Crypto.Crypto;
  const orchestrationEngine = yield* OrchestrationEngineService;
  const dispatchRepository = yield* ProjectionDispatchRepository;
  const turnRepository = yield* ProjectionTurnRepository;
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
  const receiptBus = yield* RuntimeReceiptBus;

  const randomUuid = crypto.randomUUIDv4;
  const eventId = randomUuid.pipe(Effect.map(EventId.make));
  const commandId = (tag: string) =>
    randomUuid.pipe(Effect.map((uuid) => CommandId.make(`server:dispatch-reactor:${tag}:${uuid}`)));
  const nowIso = Effect.map(DateTime.now, DateTime.formatIso);

  const upsertDispatch = Effect.fn("DispatchReactor.upsertDispatch")(function* (
    row: ProjectionDispatch,
    createdAt: string,
  ) {
    yield* orchestrationEngine.dispatch({
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
    });
  });

  const appendTaskProjection = Effect.fn("DispatchReactor.appendTaskProjection")(function* (
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
    ).pipe(Effect.asVoid);
  });

  const publishReceipt = (row: ProjectionDispatch, createdAt: string) =>
    receiptBus.publish({
      type: "dispatch.lifecycle",
      dispatchId: row.dispatchId,
      parentThreadId: row.parentThreadId,
      parentTurnId: row.parentTurnId,
      ...(row.childThreadId !== null ? { childThreadId: row.childThreadId } : {}),
      status: row.status,
      ...(row.summary !== null ? { summary: row.summary } : {}),
      ...(row.reason !== null ? { reason: row.reason } : {}),
      createdAt,
    });

  const projectProgress = Effect.fn("DispatchReactor.projectProgress")(function* (
    row: ProjectionDispatch,
    progress: NonNullable<ReturnType<typeof activityProgress>>,
    createdAt: string,
  ) {
    if (isSettledDispatchStatus(row.status)) return;
    yield* appendTaskProjection(
      row,
      {
        kind: "progress",
        summary: progress.summary,
        ...(progress.lastToolName !== undefined ? { lastToolName: progress.lastToolName } : {}),
        ...(progress.status !== undefined ? { status: progress.status } : {}),
      },
      createdAt,
    );
    if (progress.status !== undefined) {
      yield* appendTaskProjection(row, { kind: "updated", status: progress.status }, createdAt);
    }
    yield* publishReceipt(row, createdAt);
  });

  const finalAssistantSummary = Effect.fn("DispatchReactor.finalAssistantSummary")(function* (
    row: ProjectionDispatch,
  ) {
    if (row.childThreadId === null) return undefined;
    const child = yield* projectionSnapshotQuery
      .getThreadDetailById(row.childThreadId)
      .pipe(Effect.map(Option.getOrUndefined));
    const turnId = child?.latestTurn?.turnId;
    return child?.messages
      .toReversed()
      .find(
        (message) =>
          message.role === "assistant" &&
          !message.streaming &&
          (turnId === undefined || message.turnId === turnId),
      )?.text;
  });

  const settleDispatch = Effect.fn("DispatchReactor.settleDispatch")(function* (
    current: ProjectionDispatch,
    status: "completed" | "failed" | "cancelled",
    createdAt: string,
    reason?: string,
  ) {
    const latest = yield* dispatchRepository
      .getById({ dispatchId: current.dispatchId })
      .pipe(Effect.map(Option.getOrUndefined));
    if (!latest || isSettledDispatchStatus(latest.status)) return;
    const summary = status === "completed" ? yield* finalAssistantSummary(latest) : undefined;
    const row: ProjectionDispatch = {
      ...latest,
      status,
      reason: reason ?? null,
      summary: summary ?? null,
      settledAt: createdAt,
    };
    yield* upsertDispatch(row, createdAt);
    yield* appendTaskProjection(
      row,
      {
        kind: "completed",
        status: status === "completed" ? "completed" : status === "failed" ? "failed" : "stopped",
        ...(summary !== undefined ? { summary } : reason !== undefined ? { summary: reason } : {}),
      },
      createdAt,
    );
    yield* publishReceipt(row, createdAt);
  });

  const settleFromChild = Effect.fn("DispatchReactor.settleFromChild")(function* (
    row: ProjectionDispatch,
    createdAt: string,
  ) {
    if (row.childThreadId === null || isSettledDispatchStatus(row.status)) return;
    const child = yield* projectionSnapshotQuery
      .getThreadDetailById(row.childThreadId)
      .pipe(Effect.map(Option.getOrUndefined));
    if (!child?.latestTurn || child.latestTurn.state === "running") return;
    const status =
      child.latestTurn.state === "completed"
        ? ("completed" as const)
        : child.latestTurn.state === "error"
          ? ("failed" as const)
          : ("cancelled" as const);
    yield* settleDispatch(
      row,
      status,
      createdAt,
      status === "failed" ? (child.session?.lastError ?? "The child turn failed.") : undefined,
    );
  });

  const cancelDispatch = Effect.fn("DispatchReactor.cancelDispatch")(function* (
    row: ProjectionDispatch,
    createdAt: string,
  ) {
    if (isSettledDispatchStatus(row.status)) return;
    if (row.childThreadId !== null) {
      const child = yield* projectionSnapshotQuery
        .getThreadDetailById(row.childThreadId)
        .pipe(Effect.map(Option.getOrUndefined));
      if (child?.latestTurn?.state === "running") {
        yield* orchestrationEngine.dispatch({
          type: "thread.turn.interrupt",
          commandId: yield* commandId("child-interrupt"),
          threadId: row.childThreadId,
          turnId: child.latestTurn.turnId,
          createdAt,
        });
      }
    }
    yield* settleDispatch(row, "cancelled", createdAt);
  });

  const cancelForParentTurn = Effect.fn("DispatchReactor.cancelForParentTurn")(function* (input: {
    readonly parentThreadId: ProjectionDispatch["parentThreadId"];
    readonly parentTurnId?: ProjectionDispatch["parentTurnId"];
    readonly createdAt: string;
    readonly appendCompletionWarning: boolean;
  }) {
    const live = yield* dispatchRepository.listUnsettledByParentThread({
      parentThreadId: input.parentThreadId,
    });
    const owned =
      input.parentTurnId === undefined
        ? live
        : live.filter((dispatch) => dispatch.parentTurnId === input.parentTurnId);
    if (owned.length === 0) return;
    if (input.appendCompletionWarning) {
      yield* orchestrationEngine.dispatch({
        type: "thread.message.system.append",
        commandId: yield* commandId("parent-live-children-warning"),
        threadId: input.parentThreadId,
        messageId: MessageId.make(yield* randomUuid),
        text: `Turn ended with ${owned.length} agents still working. Their results were not collected.`,
        turnId: input.parentTurnId ?? null,
        createdAt: input.createdAt,
      });
    }
    yield* Effect.forEach(owned, (dispatch) => cancelDispatch(dispatch, input.createdAt), {
      concurrency: 1,
    }).pipe(Effect.asVoid);
  });

  const reconcile = Effect.fn("DispatchReactor.reconcile")(function* (row: ProjectionDispatch) {
    if (isSettledDispatchStatus(row.status)) return;
    const parentTurn = yield* turnRepository
      .getByTurnId({ threadId: row.parentThreadId, turnId: row.parentTurnId })
      .pipe(Effect.map(Option.getOrUndefined));
    if (!parentTurn || parentTurn.state !== "running") {
      yield* cancelForParentTurn({
        parentThreadId: row.parentThreadId,
        parentTurnId: row.parentTurnId,
        createdAt: yield* nowIso,
        appendCompletionWarning: parentTurn?.state === "completed",
      });
      return;
    }
    yield* settleFromChild(row, yield* nowIso);
  });

  const processDomainEvent = Effect.fn("DispatchReactor.processDomainEvent")(function* (
    event: OrchestrationEvent,
  ) {
    if (event.type === "thread.activity-appended") {
      const dispatch = yield* dispatchRepository
        .getByChildThreadId({ childThreadId: event.payload.threadId })
        .pipe(Effect.map(Option.getOrUndefined));
      const progress = activityProgress(event.payload.activity);
      if (dispatch && progress) {
        yield* projectProgress(dispatch, progress, event.occurredAt);
      }
      return;
    }

    if (event.type === "thread.session-set") {
      const childDispatch = yield* dispatchRepository
        .getByChildThreadId({ childThreadId: event.payload.threadId })
        .pipe(Effect.map(Option.getOrUndefined));
      if (childDispatch && !isSettledDispatchStatus(childDispatch.status)) {
        if (event.payload.session.status === "running") {
          yield* appendTaskProjection(
            childDispatch,
            { kind: "updated", status: "running" },
            event.occurredAt,
          );
          yield* publishReceipt(childDispatch, event.occurredAt);
        } else if (
          event.payload.session.status === "error" ||
          event.payload.session.status === "interrupted" ||
          event.payload.session.status === "stopped"
        ) {
          yield* settleFromChild(childDispatch, event.occurredAt);
        }
      }

      if (
        event.payload.session.status === "ready" ||
        event.payload.session.status === "idle" ||
        event.payload.session.status === "error" ||
        event.payload.session.status === "interrupted" ||
        event.payload.session.status === "stopped"
      ) {
        const live = yield* dispatchRepository.listUnsettledByParentThread({
          parentThreadId: event.payload.threadId,
        });
        for (const dispatch of live) {
          const parentTurn = yield* turnRepository
            .getByTurnId({
              threadId: dispatch.parentThreadId,
              turnId: dispatch.parentTurnId,
            })
            .pipe(Effect.map(Option.getOrUndefined));
          if (parentTurn && parentTurn.state !== "running") {
            yield* cancelForParentTurn({
              parentThreadId: dispatch.parentThreadId,
              parentTurnId: dispatch.parentTurnId,
              createdAt: event.occurredAt,
              appendCompletionWarning:
                parentTurn.state === "completed" &&
                (event.payload.session.status === "ready" ||
                  event.payload.session.status === "idle"),
            });
          }
        }
      }
      return;
    }

    if (event.type === "thread.turn-interrupt-requested") {
      yield* cancelForParentTurn({
        parentThreadId: event.payload.threadId,
        ...(event.payload.turnId !== undefined ? { parentTurnId: event.payload.turnId } : {}),
        createdAt: event.payload.createdAt,
        appendCompletionWarning: false,
      });
    }
  });

  const processInput = (input: DispatchInput) => {
    if (input.source === "domain") return processDomainEvent(input.event);
    if (input.source === "reconcile") return reconcile(input.dispatch);
    return dispatchRepository.getByChildThreadId({ childThreadId: input.receipt.threadId }).pipe(
      Effect.map(Option.getOrUndefined),
      Effect.flatMap((dispatch) =>
        dispatch ? settleFromChild(dispatch, input.receipt.createdAt) : Effect.void,
      ),
    );
  };

  const processInputSafely = (input: DispatchInput) =>
    processInput(input).pipe(
      Effect.catchCause((cause) => {
        if (Cause.hasInterruptsOnly(cause)) return Effect.failCause(cause);
        return Effect.logWarning("dispatch reactor failed to process input", {
          source: input.source,
          cause: Cause.pretty(cause),
        });
      }),
    );

  const worker = yield* makeDrainableWorker(processInputSafely);

  const start: DispatchReactorShape["start"] = Effect.fn("DispatchReactor.start")(function* () {
    yield* forkParked(
      Stream.runForEach(orchestrationEngine.streamDomainEvents, (event) =>
        event.type === "thread.activity-appended" ||
        event.type === "thread.session-set" ||
        event.type === "thread.turn-interrupt-requested"
          ? worker.enqueue({ source: "domain", event })
          : Effect.void,
      ),
    );
    yield* forkParked(
      Stream.runForEach(receiptBus.streamEvents, (receipt) =>
        receipt.type === "turn.processing.quiesced"
          ? worker.enqueue({ source: "receipt", receipt })
          : Effect.void,
      ),
    );
    const unsettled = yield* dispatchRepository.listUnsettled.pipe(
      Effect.catch((cause) =>
        Effect.logWarning("dispatch reactor failed to load unsettled dispatches", { cause }).pipe(
          Effect.as<ReadonlyArray<ProjectionDispatch>>([]),
        ),
      ),
    );
    yield* Effect.forEach(unsettled, (dispatch) =>
      worker.enqueue({ source: "reconcile", dispatch }),
    ).pipe(Effect.asVoid);
  });

  return { start, drain: worker.drain } satisfies DispatchReactorShape;
});

export const DispatchReactorLive = Layer.effect(DispatchReactor, make);

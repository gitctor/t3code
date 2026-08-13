import {
  CommandId,
  MessageId,
  ProviderDriverKind,
  type MessageableThread,
  type ThreadId,
  ThreadMessagingError,
  type ListMessageableThreadsResult,
  type SendToThreadInput,
  type SendToThreadResult,
  type ThreadMessage,
  type ThreadMessagingErrorCode,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Semaphore from "effect/Semaphore";
import * as SynchronizedRef from "effect/SynchronizedRef";

import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ProjectionCrossThreadMessageRepository } from "../persistence/Services/ProjectionCrossThreadMessages.ts";
import { ProjectionDispatchRepository } from "../persistence/Services/ProjectionDispatches.ts";
import { ProjectionThreadRepository } from "../persistence/Services/ProjectionThreads.ts";
import { ProviderInstanceRegistry } from "../provider/Services/ProviderInstanceRegistry.ts";
import * as ServerSettings from "../serverSettings.ts";
import { makeCrossThreadMessageDelivery } from "./CrossThreadMessageDelivery.ts";
import type { McpInvocationScope } from "./McpInvocationContext.ts";

export const MAX_CROSS_THREAD_SENDS_PER_SOURCE_TURN = 20;

export interface ThreadMessagingBrokerShape {
  readonly listThreads: (
    scope: McpInvocationScope,
  ) => Effect.Effect<ListMessageableThreadsResult, ThreadMessagingError>;
  readonly send: (
    scope: McpInvocationScope,
    input: SendToThreadInput,
  ) => Effect.Effect<SendToThreadResult, ThreadMessagingError>;
}

export class ThreadMessagingBroker extends Context.Service<
  ThreadMessagingBroker,
  ThreadMessagingBrokerShape
>()("t3/mcp/ThreadMessagingBroker") {}

const messagingError = (code: ThreadMessagingErrorCode, message: string) =>
  new ThreadMessagingError({ code, message });

const mapUnavailable = (message: string) =>
  Effect.mapError(() => messagingError("delivery-failed", message));

export const make = Effect.gen(function* () {
  const crypto = yield* Crypto.Crypto;
  const engine = yield* OrchestrationEngineService;
  const snapshots = yield* ProjectionSnapshotQuery;
  const messages = yield* ProjectionCrossThreadMessageRepository;
  const dispatches = yield* ProjectionDispatchRepository;
  const threads = yield* ProjectionThreadRepository;
  const instances = yield* ProviderInstanceRegistry;
  const environment = yield* ServerEnvironment.ServerEnvironment;
  const settings = yield* ServerSettings.ServerSettingsService;
  const deliverCrossThreadMessage = yield* makeCrossThreadMessageDelivery;
  const sendSemaphores = yield* SynchronizedRef.make(new Map<ThreadId, Semaphore.Semaphore>());
  const environmentId = yield* environment.getEnvironmentId;

  const sendSemaphoreFor = Effect.fn("ThreadMessagingBroker.sendSemaphoreFor")(function* (
    threadId: ThreadId,
  ) {
    const created = yield* Semaphore.make(1);
    return yield* SynchronizedRef.modify(sendSemaphores, (current) => {
      const existing = current.get(threadId);
      if (existing) return [existing, current] as const;
      const next = new Map(current);
      next.set(threadId, created);
      return [created, next] as const;
    });
  });

  const currentSource = Effect.fn("ThreadMessagingBroker.currentSource")(function* (
    scope: McpInvocationScope,
  ) {
    const source = yield* snapshots
      .getThreadDetailById(scope.threadId)
      .pipe(mapUnavailable("The source thread is unavailable."), Effect.map(Option.getOrUndefined));
    const sourceTurnId = source?.session?.activeTurnId;
    if (
      !source ||
      source.session?.status !== "running" ||
      sourceTurnId === null ||
      sourceTurnId === undefined ||
      (source.session.providerInstanceId !== undefined &&
        source.session.providerInstanceId !== scope.providerInstanceId)
    ) {
      return yield* messagingError(
        "source-turn-unavailable",
        "Cross-thread messaging requires an active source turn.",
      );
    }
    return { source, sourceTurnId } as const;
  });

  const crewThreadIds = Effect.fn("ThreadMessagingBroker.crewThreadIds")(function* (
    sourceThreadId: ThreadId,
  ) {
    const allowed = new Set<ThreadId>();
    const origin = Option.getOrUndefined(
      yield* dispatches
        .getByChildThreadId({ childThreadId: sourceThreadId })
        .pipe(mapUnavailable("Crew dispatch state is unavailable.")),
    );
    if (origin) {
      allowed.add(origin.parentThreadId);
      const siblings = yield* dispatches
        .listByParentTurn({
          parentThreadId: origin.parentThreadId,
          parentTurnId: origin.parentTurnId,
        })
        .pipe(mapUnavailable("Crew dispatch state is unavailable."));
      for (const sibling of siblings) {
        if (sibling.childThreadId !== null) allowed.add(sibling.childThreadId);
      }
    }
    const children = yield* dispatches
      .listByParentThread({ parentThreadId: sourceThreadId })
      .pipe(mapUnavailable("Crew dispatch state is unavailable."));
    for (const child of children) {
      if (child.childThreadId !== null) allowed.add(child.childThreadId);
    }
    allowed.delete(sourceThreadId);
    return allowed;
  });

  const messageableThreadIds = Effect.fn("ThreadMessagingBroker.messageableThreadIds")(function* (
    scope: McpInvocationScope,
  ) {
    const { source } = yield* currentSource(scope);
    if (scope.environmentId !== environmentId) {
      return yield* messagingError(
        "cross-environment",
        "Cross-thread messages cannot cross environments.",
      );
    }
    const level = (yield* settings.getSettings.pipe(
      Effect.mapError(() =>
        messagingError("delivery-failed", "Messaging settings are unavailable."),
      ),
    )).crossThreadMessaging;
    if (level === "off") {
      return yield* messagingError(
        "capability-unavailable",
        "Cross-thread messaging is disabled by the operator.",
      );
    }
    if (level === "crew") {
      return { source, allowed: yield* crewThreadIds(source.id) } as const;
    }
    const projectThreads = yield* threads
      .listByProjectId({ projectId: source.projectId })
      .pipe(mapUnavailable("Project thread state is unavailable."));
    return {
      source,
      allowed: new Set(
        projectThreads
          .filter((thread) => thread.deletedAt === null && thread.threadId !== source.id)
          .map((thread) => thread.threadId),
      ),
    } as const;
  });

  const listThreads: ThreadMessagingBrokerShape["listThreads"] = Effect.fn(
    "ThreadMessagingBroker.listThreads",
  )(function* (scope) {
    const { allowed } = yield* messageableThreadIds(scope);
    const result: MessageableThread[] = [];
    for (const threadId of allowed) {
      const thread = Option.getOrUndefined(
        yield* snapshots
          .getThreadDetailById(threadId)
          .pipe(mapUnavailable("Messageable thread state is unavailable.")),
      );
      if (!thread || thread.deletedAt !== null) continue;
      const instance = yield* instances.getInstance(thread.modelSelection.instanceId);
      result.push({
        id: thread.id,
        title: thread.title,
        provider: instance?.driverKind ?? ProviderDriverKind.make("unknown"),
        state:
          thread.latestTurn?.state === "running" ||
          thread.session?.status === "running" ||
          thread.session?.status === "starting"
            ? ("running" as const)
            : ("idle" as const),
      });
    }
    return { threads: result };
  });

  const commandId = (messageId: MessageId, suffix: string) =>
    CommandId.make(`server:cross-thread-message:${messageId}:${suffix}`);

  const reject = Effect.fn("ThreadMessagingBroker.reject")(function* (input: {
    readonly message: ThreadMessage;
    readonly reason: string;
    readonly code: ThreadMessagingErrorCode;
  }) {
    const rejected = {
      ...input.message,
      status: "rejected" as const,
      reason: input.reason,
    };
    yield* engine
      .dispatch({
        type: "message.reject",
        commandId: commandId(rejected.messageId, "rejected"),
        message: rejected,
      })
      .pipe(mapUnavailable("The rejected message audit could not be saved."));
    yield* engine
      .dispatch({
        type: "thread.message.system.append",
        commandId: commandId(rejected.messageId, "source-rejection-audit"),
        threadId: rejected.sourceThreadId,
        messageId: MessageId.make(`cross-thread-rejection:${rejected.messageId}`),
        text: `Cross-thread message rejected: ${input.reason}`,
        turnId: rejected.sourceTurnId,
        createdAt: rejected.createdAt,
      })
      .pipe(mapUnavailable("The rejection transcript audit could not be saved."));
    return yield* messagingError(input.code, input.reason);
  });

  const sendUnlocked = Effect.fn("ThreadMessagingBroker.sendUnlocked")(function* (
    scope: McpInvocationScope,
    input: SendToThreadInput,
  ) {
    const { source, sourceTurnId } = yield* currentSource(scope);
    const createdAt = DateTime.formatIso(yield* DateTime.now);
    const messageId = MessageId.make(yield* crypto.randomUUIDv4.pipe(Effect.orDie));
    const message: ThreadMessage = {
      messageId,
      environmentId,
      sourceThreadId: source.id,
      sourceTurnId,
      targetThreadId: input.targetThreadId,
      body: input.body,
      status: "queued",
      createdAt,
    };

    const priorCount = yield* messages
      .countBySourceTurn({ environmentId, sourceThreadId: source.id, sourceTurnId })
      .pipe(mapUnavailable("Message rate-limit state is unavailable."));
    if (priorCount >= MAX_CROSS_THREAD_SENDS_PER_SOURCE_TURN) {
      return yield* reject({
        message,
        code: "rate-limit-reached",
        reason: `This turn already sent ${MAX_CROSS_THREAD_SENDS_PER_SOURCE_TURN} cross-thread messages.`,
      });
    }

    const scopeResult = yield* messageableThreadIds(scope).pipe(Effect.result);
    if (Result.isFailure(scopeResult)) {
      return yield* reject({
        message,
        code: scopeResult.failure.code,
        reason: scopeResult.failure.message,
      });
    }
    const target = Option.getOrUndefined(
      yield* snapshots
        .getThreadDetailById(input.targetThreadId)
        .pipe(mapUnavailable("The target thread is unavailable.")),
    );
    if (!target || target.deletedAt !== null) {
      return yield* reject({
        message,
        code: "target-not-found",
        reason: `Target thread '${input.targetThreadId}' was not found.`,
      });
    }
    if (!scopeResult.success.allowed.has(target.id)) {
      return yield* reject({
        message,
        code: "scope-violation",
        reason: `Target thread '${target.title}' is outside the allowed messaging scope.`,
      });
    }

    yield* engine
      .dispatch({
        type: "message.send",
        commandId: commandId(messageId, "sent"),
        message,
      })
      .pipe(mapUnavailable("The message could not be queued."));
    const delivery = yield* deliverCrossThreadMessage(message).pipe(
      mapUnavailable("The message delivery machinery failed."),
    );
    return { message: delivery || message };
  });

  return ThreadMessagingBroker.of({
    listThreads,
    send: (scope, input) =>
      Effect.gen(function* () {
        const semaphore = yield* sendSemaphoreFor(scope.threadId);
        return yield* semaphore.withPermits(1)(sendUnlocked(scope, input));
      }),
  });
});

export const layer = Layer.effect(ThreadMessagingBroker, make);

export const unavailableLayer = Layer.succeed(
  ThreadMessagingBroker,
  ThreadMessagingBroker.of({
    listThreads: () =>
      Effect.fail(
        messagingError("capability-unavailable", "Cross-thread messaging is unavailable."),
      ),
    send: () =>
      Effect.fail(
        messagingError("capability-unavailable", "Cross-thread messaging is unavailable."),
      ),
  }),
);

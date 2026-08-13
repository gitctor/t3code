import type { OrchestrationEvent, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SynchronizedRef from "effect/SynchronizedRef";

import { makeCrossThreadMessageDelivery } from "../../mcp/CrossThreadMessageDelivery.ts";
import * as ServerEnvironment from "../../environment/ServerEnvironment.ts";
import { ProjectionCrossThreadMessageRepository } from "../../persistence/Services/ProjectionCrossThreadMessages.ts";
import { forkParked } from "../../serverActivation.ts";
import { crossThreadMessageFromProjection } from "../CrossThreadMessageProjection.ts";
import {
  CrossThreadMessageReactor,
  type CrossThreadMessageReactorShape,
} from "../Services/CrossThreadMessageReactor.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";

const make = Effect.gen(function* () {
  const engine = yield* OrchestrationEngineService;
  const messages = yield* ProjectionCrossThreadMessageRepository;
  const environment = yield* ServerEnvironment.ServerEnvironment;
  const environmentId = yield* environment.getEnvironmentId;
  const deliverCrossThreadMessage = yield* makeCrossThreadMessageDelivery;
  const semaphores = yield* SynchronizedRef.make(new Map<ThreadId, Semaphore.Semaphore>());

  const semaphoreFor = Effect.fn("CrossThreadMessageReactor.semaphoreFor")(function* (
    threadId: ThreadId,
  ) {
    const created = yield* Semaphore.make(1);
    return yield* SynchronizedRef.modify(semaphores, (current) => {
      const existing = current.get(threadId);
      if (existing) return [existing, current] as const;
      const next = new Map(current);
      next.set(threadId, created);
      return [created, next] as const;
    });
  });

  const drainTarget = Effect.fn("CrossThreadMessageReactor.drainTarget")(function* (
    targetThreadId: ThreadId,
  ) {
    const semaphore = yield* semaphoreFor(targetThreadId);
    yield* semaphore.withPermits(1)(
      Effect.gen(function* () {
        const queue = yield* messages.listQueuedByTarget({
          environmentId,
          targetThreadId,
        });
        const head = queue[0];
        if (!head) return;
        yield* deliverCrossThreadMessage(crossThreadMessageFromProjection(head));
      }),
    );
  });

  const processEvent = Effect.fn("CrossThreadMessageReactor.processEvent")(function* (
    event: OrchestrationEvent,
  ) {
    if (
      event.type === "thread.session-set" &&
      event.payload.session.status !== "starting" &&
      event.payload.session.status !== "running"
    ) {
      yield* drainTarget(event.payload.threadId);
    }
  });

  const processEventSafely = (event: OrchestrationEvent) =>
    processEvent(event).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("cross-thread message reactor failed", {
          eventType: event.type,
          cause,
        }),
      ),
    );

  const start: CrossThreadMessageReactorShape["start"] = Effect.fn(
    "CrossThreadMessageReactor.start",
  )(function* () {
    yield* forkParked(Stream.runForEach(engine.streamDomainEvents, processEventSafely));
    const queued = yield* messages.listQueued.pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("cross-thread queue bootstrap failed", { cause }).pipe(Effect.as([])),
      ),
    );
    const targetThreadIds = new Set(queued.map((message) => message.targetThreadId));
    yield* Effect.forEach(
      targetThreadIds,
      (threadId) =>
        drainTarget(threadId).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("cross-thread queue bootstrap target failed", {
              threadId,
              cause,
            }),
          ),
        ),
      { concurrency: "unbounded" },
    );
  });

  return CrossThreadMessageReactor.of({ start });
});

export const CrossThreadMessageReactorLive = Layer.effect(CrossThreadMessageReactor, make);

import type { ThreadId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Semaphore from "effect/Semaphore";
import * as SynchronizedRef from "effect/SynchronizedRef";

export interface CrossThreadMessageDeliveryLockShape {
  readonly withTargetLock: <A, E, R>(
    targetThreadId: ThreadId,
    effect: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E, R>;
}

export class CrossThreadMessageDeliveryLock extends Context.Service<
  CrossThreadMessageDeliveryLock,
  CrossThreadMessageDeliveryLockShape
>()("t3/mcp/CrossThreadMessageDeliveryLock") {}

const make = SynchronizedRef.make(new Map<ThreadId, Semaphore.Semaphore>()).pipe(
  Effect.map((semaphores) =>
    CrossThreadMessageDeliveryLock.of({
      withTargetLock: (targetThreadId, effect) =>
        Effect.gen(function* () {
          const created = yield* Semaphore.make(1);
          const semaphore = yield* SynchronizedRef.modify(semaphores, (current) => {
            const existing = current.get(targetThreadId);
            if (existing) return [existing, current] as const;
            const next = new Map(current);
            next.set(targetThreadId, created);
            return [created, next] as const;
          });
          return yield* semaphore.withPermits(1)(effect);
        }),
    }),
  ),
);

export const CrossThreadMessageDeliveryLockLive = Layer.effect(
  CrossThreadMessageDeliveryLock,
  make,
);

import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";

export interface DispatchReactorShape {
  readonly start: () => Effect.Effect<void, never, Scope.Scope>;
  readonly drain: Effect.Effect<void>;
}

export class DispatchReactor extends Context.Service<DispatchReactor, DispatchReactorShape>()(
  "t3/orchestration/Services/DispatchReactor",
) {}

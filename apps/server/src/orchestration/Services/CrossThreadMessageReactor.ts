import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";

export interface CrossThreadMessageReactorShape {
  readonly start: () => Effect.Effect<void, never, Scope.Scope>;
}

export class CrossThreadMessageReactor extends Context.Service<
  CrossThreadMessageReactor,
  CrossThreadMessageReactorShape
>()("t3/orchestration/Services/CrossThreadMessageReactor") {}

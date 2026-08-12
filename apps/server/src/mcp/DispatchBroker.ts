import type {
  AwaitDispatchInput,
  DispatchAccepted,
  DispatchInput,
  DispatchListing,
  DispatchOutcome,
} from "@t3tools/contracts";
import { OrchestrationError } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import type { McpInvocationScope } from "./McpInvocationContext.ts";

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

const unavailable = () =>
  new OrchestrationError({
    code: "not-orchestrating",
    message: "No crew is active for this thread.",
  });

export const layer = Layer.succeed(
  DispatchBroker,
  DispatchBroker.of({
    dispatch: Effect.fn("DispatchBroker.dispatch")(function* () {
      return yield* unavailable();
    }),
    awaitDispatch: Effect.fn("DispatchBroker.awaitDispatch")(function* () {
      return yield* unavailable();
    }),
    listDispatches: Effect.fn("DispatchBroker.listDispatches")(function* () {
      return yield* unavailable();
    }),
  }),
);

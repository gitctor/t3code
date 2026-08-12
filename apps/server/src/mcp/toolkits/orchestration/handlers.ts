import * as Effect from "effect/Effect";

import * as DispatchBroker from "../../DispatchBroker.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { OrchestrationToolkit } from "./tools.ts";

const handlers = {
  dispatch: (input) =>
    Effect.gen(function* () {
      const scope = yield* McpInvocationContext.requireMcpCapability("orchestration");
      const broker = yield* DispatchBroker.DispatchBroker;
      return yield* broker.dispatch(scope, input);
    }),
  await_dispatch: (input) =>
    Effect.gen(function* () {
      const scope = yield* McpInvocationContext.requireMcpCapability("orchestration");
      const broker = yield* DispatchBroker.DispatchBroker;
      return yield* broker.awaitDispatch(scope, input);
    }),
  list_dispatches: () =>
    Effect.gen(function* () {
      const scope = yield* McpInvocationContext.requireMcpCapability("orchestration");
      const broker = yield* DispatchBroker.DispatchBroker;
      return yield* broker.listDispatches(scope);
    }),
} satisfies Parameters<typeof OrchestrationToolkit.toLayer>[0];

export const OrchestrationToolkitHandlersLive = OrchestrationToolkit.toLayer(handlers);

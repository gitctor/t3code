import * as Effect from "effect/Effect";

import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as ThreadMessagingBroker from "../../ThreadMessagingBroker.ts";
import { MessagingToolkit } from "./tools.ts";

const handlers = {
  list_threads: () =>
    Effect.gen(function* () {
      const scope = yield* McpInvocationContext.requireMcpCapability("messaging");
      const broker = yield* ThreadMessagingBroker.ThreadMessagingBroker;
      return yield* broker.listThreads(scope);
    }),
  send_to_thread: (input) =>
    Effect.gen(function* () {
      const scope = yield* McpInvocationContext.requireMcpCapability("messaging");
      const broker = yield* ThreadMessagingBroker.ThreadMessagingBroker;
      return yield* broker.send(scope, input);
    }),
} satisfies Parameters<typeof MessagingToolkit.toLayer>[0];

export const MessagingToolkitHandlersLive = MessagingToolkit.toLayer(handlers);

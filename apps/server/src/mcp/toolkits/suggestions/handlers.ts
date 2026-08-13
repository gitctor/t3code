import * as Effect from "effect/Effect";

import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as TaskSuggestionBroker from "../../TaskSuggestionBroker.ts";
import { SuggestionsToolkit } from "./tools.ts";

const handlers = {
  suggest_task: (input) =>
    Effect.gen(function* () {
      const scope = yield* McpInvocationContext.requireMcpCapability("suggestions");
      const broker = yield* TaskSuggestionBroker.TaskSuggestionBroker;
      return yield* broker.suggest(scope, input);
    }),
} satisfies Parameters<typeof SuggestionsToolkit.toLayer>[0];

export const SuggestionsToolkitHandlersLive = SuggestionsToolkit.toLayer(handlers);

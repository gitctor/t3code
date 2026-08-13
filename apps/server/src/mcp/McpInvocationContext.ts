import {
  type EnvironmentId,
  OrchestrationError,
  PreviewAutomationUnavailableError,
  TaskSuggestionError,
  ThreadMessagingError,
  type ProviderInstanceId,
  type ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";

export type McpCapability = "preview" | "orchestration" | "suggestions" | "messaging";

export interface McpInvocationScope {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly providerSessionId: string;
  readonly providerInstanceId: ProviderInstanceId;
  readonly capabilities: ReadonlySet<McpCapability>;
  readonly issuedAt: number;
}

export class McpInvocationContext extends Context.Service<
  McpInvocationContext,
  McpInvocationScope
>()("t3/mcp/McpInvocationContext") {}

const requirePreviewCapability = Effect.fn("mcp.requirePreviewCapability")(function* () {
  const invocation = yield* McpInvocationContext;
  if (!invocation.capabilities.has("preview")) {
    return yield* new PreviewAutomationUnavailableError({
      capability: "preview",
      environmentId: invocation.environmentId,
      threadId: invocation.threadId,
      providerSessionId: invocation.providerSessionId,
      providerInstanceId: invocation.providerInstanceId,
    });
  }
  return invocation;
});

const requireOrchestrationCapability = Effect.fn("mcp.requireOrchestrationCapability")(
  function* () {
    const invocation = yield* McpInvocationContext;
    if (!invocation.capabilities.has("orchestration")) {
      return yield* new OrchestrationError({
        code: "not-orchestrating",
        message: "No crew is active for this thread.",
      });
    }
    return invocation;
  },
);

const requireSuggestionsCapability = Effect.fn("mcp.requireSuggestionsCapability")(function* () {
  const invocation = yield* McpInvocationContext;
  if (!invocation.capabilities.has("suggestions")) {
    return yield* new TaskSuggestionError({
      code: "capability-unavailable",
      message: "MCP credential does not grant the suggestions capability.",
    });
  }
  return invocation;
});

const requireMessagingCapability = Effect.fn("mcp.requireMessagingCapability")(function* () {
  const invocation = yield* McpInvocationContext;
  if (!invocation.capabilities.has("messaging")) {
    return yield* new ThreadMessagingError({
      code: "capability-unavailable",
      message: "MCP credential does not grant the messaging capability.",
    });
  }
  return invocation;
});

export function requireMcpCapability(
  capability: "preview",
): Effect.Effect<McpInvocationScope, PreviewAutomationUnavailableError, McpInvocationContext>;
export function requireMcpCapability(
  capability: "orchestration",
): Effect.Effect<McpInvocationScope, OrchestrationError, McpInvocationContext>;
export function requireMcpCapability(
  capability: "suggestions",
): Effect.Effect<McpInvocationScope, TaskSuggestionError, McpInvocationContext>;
export function requireMcpCapability(
  capability: "messaging",
): Effect.Effect<McpInvocationScope, ThreadMessagingError, McpInvocationContext>;
export function requireMcpCapability(capability: McpCapability) {
  switch (capability) {
    case "preview":
      return requirePreviewCapability();
    case "orchestration":
      return requireOrchestrationCapability();
    case "suggestions":
      return requireSuggestionsCapability();
    case "messaging":
      return requireMessagingCapability();
  }
}

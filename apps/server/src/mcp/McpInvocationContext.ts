import {
  type EnvironmentId,
  OrchestrationError,
  PreviewAutomationUnavailableError,
  type ProviderInstanceId,
  type ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";

export type McpCapability = "preview" | "orchestration";

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

export function requireMcpCapability(
  capability: "preview",
): Effect.Effect<McpInvocationScope, PreviewAutomationUnavailableError, McpInvocationContext>;
export function requireMcpCapability(
  capability: "orchestration",
): Effect.Effect<McpInvocationScope, OrchestrationError, McpInvocationContext>;
export function requireMcpCapability(capability: McpCapability) {
  return capability === "preview" ? requirePreviewCapability() : requireOrchestrationCapability();
}

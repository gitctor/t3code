import type { McpCapability } from "./McpInvocationContext.ts";

export const T3_CODE_MCP_SERVER_NAME = "t3-code";

export const ORCHESTRATION_MCP_TOOL_NAMES = [
  "dispatch",
  "await_dispatch",
  "list_dispatches",
] as const;

const orchestrationMcpToolNames = new Set<string>(ORCHESTRATION_MCP_TOOL_NAMES);

export const isOrchestrationMcpToolName = (toolName: string): boolean =>
  orchestrationMcpToolNames.has(toolName);

export const canAutoApproveOrchestrationMcpTool = (input: {
  readonly capabilities: ReadonlySet<McpCapability> | undefined;
  readonly serverName: string;
  readonly toolName: string;
}): boolean =>
  input.capabilities?.has("orchestration") === true &&
  input.serverName === T3_CODE_MCP_SERVER_NAME &&
  isOrchestrationMcpToolName(input.toolName);

export const parseClaudeMcpToolName = (
  toolName: string,
): { readonly serverName: string; readonly toolName: string } | undefined => {
  const prefix = "mcp__";
  if (!toolName.startsWith(prefix)) {
    return undefined;
  }
  const separatorIndex = toolName.indexOf("__", prefix.length);
  if (separatorIndex === -1) {
    return undefined;
  }
  return {
    serverName: toolName.slice(prefix.length, separatorIndex),
    toolName: toolName.slice(separatorIndex + 2),
  };
};

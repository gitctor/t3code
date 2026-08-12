import type { RuntimeSubagent } from "@t3tools/client-runtime/state/subagentRuntime";

export function canOpenAgentTranscript(agent: Pick<RuntimeSubagent, "childThreadId">): boolean {
  return Boolean(agent.childThreadId);
}

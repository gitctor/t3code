import { SuggestTaskInput, SuggestTaskResult, TaskSuggestionError } from "@t3tools/contracts";
import { Tool, Toolkit } from "effect/unstable/ai";

import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as TaskSuggestionBroker from "../../TaskSuggestionBroker.ts";

const dependencies = [
  McpInvocationContext.McpInvocationContext,
  TaskSuggestionBroker.TaskSuggestionBroker,
];

export const SuggestTaskTool = Tool.make("suggest_task", {
  description:
    "Suggest a follow-up task sparingly. Use this only for a self-contained follow-up worth its own agent session. Give an honest concurrency verdict: parallel-safe only when it can run beside the current work without shared-state conflicts; otherwise use run-solo and explain why.",
  parameters: SuggestTaskInput,
  success: SuggestTaskResult,
  failure: TaskSuggestionError,
  dependencies,
})
  .annotate(Tool.Title, "Suggest follow-up task")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false);

export const SuggestionsToolkit = Toolkit.make(SuggestTaskTool);

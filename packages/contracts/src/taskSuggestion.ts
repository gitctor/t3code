import * as Schema from "effect/Schema";

import {
  CommandId,
  EnvironmentId,
  ForwardCompatibleArray,
  IsoDateTime,
  ThreadId,
  TrimmedNonEmptyString,
  TurnId,
} from "./baseSchemas.ts";
import { ProviderInstanceId } from "./providerInstance.ts";

export const TaskSuggestionId = TrimmedNonEmptyString.pipe(Schema.brand("TaskSuggestionId"));
export type TaskSuggestionId = typeof TaskSuggestionId.Type;

export const TaskSuggestionConcurrency = Schema.Literals(["parallel-safe", "run-solo"]);
export type TaskSuggestionConcurrency = typeof TaskSuggestionConcurrency.Type;

export const TaskSuggestionStatus = Schema.Literals(["pending", "accepted", "dismissed"]);
export type TaskSuggestionStatus = typeof TaskSuggestionStatus.Type;

export const TaskSuggestionTitle = TrimmedNonEmptyString.check(Schema.isMaxLength(80));
export const TaskSuggestionPrompt = TrimmedNonEmptyString.check(Schema.isMaxLength(20_000));
export const TaskSuggestionSoloReason = TrimmedNonEmptyString.check(Schema.isMaxLength(120));

/** Durable operator-facing follow-up proposed by an agent turn. */
export const TaskSuggestion = Schema.Struct({
  suggestionId: TaskSuggestionId,
  environmentId: EnvironmentId,
  sourceThreadId: ThreadId,
  sourceTurnId: TurnId,
  title: TaskSuggestionTitle,
  prompt: TaskSuggestionPrompt,
  instanceId: Schema.optionalKey(ProviderInstanceId),
  model: Schema.optionalKey(TrimmedNonEmptyString),
  effort: Schema.optionalKey(TrimmedNonEmptyString),
  concurrency: TaskSuggestionConcurrency,
  soloReason: Schema.optionalKey(TaskSuggestionSoloReason),
  status: TaskSuggestionStatus,
  createdAt: IsoDateTime,
  resolvedAt: Schema.optionalKey(IsoDateTime),
  acceptedThreadId: Schema.optionalKey(ThreadId),
});
export type TaskSuggestion = typeof TaskSuggestion.Type;

export const TaskSuggestions = ForwardCompatibleArray(TaskSuggestion);
export type TaskSuggestions = typeof TaskSuggestions.Type;

/** Agent-authored fields. Environment, source, lifecycle, and ids are server-owned. */
export const SuggestTaskInput = Schema.Struct({
  title: TaskSuggestionTitle,
  prompt: TaskSuggestionPrompt,
  instanceId: Schema.optionalKey(ProviderInstanceId),
  model: Schema.optionalKey(TrimmedNonEmptyString),
  effort: Schema.optionalKey(TrimmedNonEmptyString),
  concurrency: TaskSuggestionConcurrency,
  soloReason: Schema.optionalKey(TaskSuggestionSoloReason),
});
export type SuggestTaskInput = typeof SuggestTaskInput.Type;

export const SuggestTaskResult = Schema.Struct({ suggestion: TaskSuggestion });
export type SuggestTaskResult = typeof SuggestTaskResult.Type;

export const TaskSuggestionErrorCode = Schema.Literals([
  "capability-unavailable",
  "pending-limit-reached",
  "source-turn-unavailable",
  "suggestion-not-found",
  "invalid-status",
  "acceptance-failed",
]);
export type TaskSuggestionErrorCode = typeof TaskSuggestionErrorCode.Type;

export class TaskSuggestionError extends Schema.ErrorClass<TaskSuggestionError>(
  "TaskSuggestionError",
)({
  code: TaskSuggestionErrorCode,
  message: TrimmedNonEmptyString,
}) {}

export const TaskSuggestionListInput = Schema.Struct({
  status: Schema.optionalKey(TaskSuggestionStatus),
  sourceThreadId: Schema.optionalKey(ThreadId),
});
export type TaskSuggestionListInput = typeof TaskSuggestionListInput.Type;

export const TaskSuggestionListResult = Schema.Struct({ suggestions: TaskSuggestions });
export type TaskSuggestionListResult = typeof TaskSuggestionListResult.Type;

export const TaskSuggestionActionInput = Schema.Struct({ suggestionId: TaskSuggestionId });
export type TaskSuggestionActionInput = typeof TaskSuggestionActionInput.Type;

export const TaskSuggestionActionResult = Schema.Struct({ suggestion: TaskSuggestion });
export type TaskSuggestionActionResult = typeof TaskSuggestionActionResult.Type;

export const TaskSuggestionAcceptResult = Schema.Struct({
  suggestion: TaskSuggestion,
  threadId: ThreadId,
});
export type TaskSuggestionAcceptResult = typeof TaskSuggestionAcceptResult.Type;

export const SUGGESTIONS_WS_METHODS = {
  list: "suggestions.list",
  accept: "suggestions.accept",
  dismiss: "suggestions.dismiss",
  restore: "suggestions.restore",
} as const;

/** Internal commands. Clients use the operator-only suggestion RPCs instead. */
export const TaskSuggestionCreateCommand = Schema.Struct({
  type: Schema.Literal("suggestion.create"),
  commandId: CommandId,
  suggestion: TaskSuggestion,
});
export type TaskSuggestionCreateCommand = typeof TaskSuggestionCreateCommand.Type;

export const TaskSuggestionAcceptCommand = Schema.Struct({
  type: Schema.Literal("suggestion.accept"),
  commandId: CommandId,
  suggestion: TaskSuggestion,
});
export type TaskSuggestionAcceptCommand = typeof TaskSuggestionAcceptCommand.Type;

export const TaskSuggestionDismissCommand = Schema.Struct({
  type: Schema.Literal("suggestion.dismiss"),
  commandId: CommandId,
  suggestion: TaskSuggestion,
});
export type TaskSuggestionDismissCommand = typeof TaskSuggestionDismissCommand.Type;

export const TaskSuggestionRestoreCommand = Schema.Struct({
  type: Schema.Literal("suggestion.restore"),
  commandId: CommandId,
  suggestion: TaskSuggestion,
  restoredAt: IsoDateTime,
});
export type TaskSuggestionRestoreCommand = typeof TaskSuggestionRestoreCommand.Type;

export const TaskSuggestionCreatedPayload = Schema.Struct({ suggestion: TaskSuggestion });
export type TaskSuggestionCreatedPayload = typeof TaskSuggestionCreatedPayload.Type;

export const TaskSuggestionAcceptedPayload = Schema.Struct({ suggestion: TaskSuggestion });
export type TaskSuggestionAcceptedPayload = typeof TaskSuggestionAcceptedPayload.Type;

export const TaskSuggestionDismissedPayload = Schema.Struct({ suggestion: TaskSuggestion });
export type TaskSuggestionDismissedPayload = typeof TaskSuggestionDismissedPayload.Type;

export const TaskSuggestionRestoredPayload = Schema.Struct({ suggestion: TaskSuggestion });
export type TaskSuggestionRestoredPayload = typeof TaskSuggestionRestoredPayload.Type;

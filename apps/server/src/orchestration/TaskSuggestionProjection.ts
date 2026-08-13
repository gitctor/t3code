import type { OrchestrationEvent, TaskSuggestion } from "@t3tools/contracts";

import type { ProjectionTaskSuggestion } from "../persistence/Services/ProjectionTaskSuggestions.ts";

export type TaskSuggestionLifecycleEvent = Extract<
  OrchestrationEvent,
  {
    readonly type:
      | "suggestion.created"
      | "suggestion.accepted"
      | "suggestion.dismissed"
      | "suggestion.restored";
  }
>;

/** Convert the event-owned suggestion shape into its nullable SQLite row. */
export function taskSuggestionProjectionRow(
  event: TaskSuggestionLifecycleEvent,
): ProjectionTaskSuggestion {
  const suggestion = event.payload.suggestion;
  return {
    suggestionId: suggestion.suggestionId,
    environmentId: suggestion.environmentId,
    sourceThreadId: suggestion.sourceThreadId,
    sourceTurnId: suggestion.sourceTurnId,
    title: suggestion.title,
    prompt: suggestion.prompt,
    instanceId: suggestion.instanceId ?? null,
    model: suggestion.model ?? null,
    effort: suggestion.effort ?? null,
    concurrency: suggestion.concurrency,
    soloReason: suggestion.soloReason ?? null,
    status: suggestion.status,
    createdAt: suggestion.createdAt,
    resolvedAt: suggestion.resolvedAt ?? null,
    acceptedThreadId: suggestion.acceptedThreadId ?? null,
  };
}

/** Restore optional fields after reading the nullable SQLite projection. */
export function taskSuggestionFromProjection(row: ProjectionTaskSuggestion): TaskSuggestion {
  return {
    suggestionId: row.suggestionId,
    environmentId: row.environmentId,
    sourceThreadId: row.sourceThreadId,
    sourceTurnId: row.sourceTurnId,
    title: row.title,
    prompt: row.prompt,
    ...(row.instanceId !== null ? { instanceId: row.instanceId } : {}),
    ...(row.model !== null ? { model: row.model } : {}),
    ...(row.effort !== null ? { effort: row.effort } : {}),
    concurrency: row.concurrency,
    ...(row.soloReason !== null ? { soloReason: row.soloReason } : {}),
    status: row.status,
    createdAt: row.createdAt,
    ...(row.resolvedAt !== null ? { resolvedAt: row.resolvedAt } : {}),
    ...(row.acceptedThreadId !== null ? { acceptedThreadId: row.acceptedThreadId } : {}),
  };
}

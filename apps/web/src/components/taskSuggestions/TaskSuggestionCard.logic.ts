import type { TaskSuggestion } from "@t3tools/contracts";

export type TaskSuggestionCardAction = "accept" | "dismiss" | "open" | "restore";

export interface TaskSuggestionCardState {
  readonly primaryAction: TaskSuggestionCardAction | null;
  readonly secondaryAction: TaskSuggestionCardAction | null;
  readonly statusLabel: string | null;
}

export function resolveTaskSuggestionCardState(
  suggestion: Pick<TaskSuggestion, "acceptedThreadId" | "status">,
): TaskSuggestionCardState {
  switch (suggestion.status) {
    case "pending":
      return { primaryAction: "accept", secondaryAction: "dismiss", statusLabel: null };
    case "dismissed":
      return { primaryAction: "restore", secondaryAction: null, statusLabel: "Dismissed" };
    case "accepted":
      return {
        primaryAction: suggestion.acceptedThreadId === undefined ? null : "open",
        secondaryAction: null,
        statusLabel: "Accepted",
      };
  }
}

export function taskSuggestionConcurrencyPresentation(
  suggestion: Pick<TaskSuggestion, "concurrency" | "soloReason">,
): { readonly label: string; readonly tooltip: string; readonly warning: boolean } {
  if (suggestion.concurrency === "parallel-safe") {
    return {
      label: "Parallel-safe",
      tooltip: "This task can run beside other tasks.",
      warning: false,
    };
  }
  return {
    label: "Run solo — touches shared state",
    tooltip: suggestion.soloReason ?? "This task should run without other active work.",
    warning: true,
  };
}

export function taskSuggestionRecommendationLabel(
  suggestion: Pick<TaskSuggestion, "effort" | "model">,
): string {
  const model = suggestion.model ?? "Default model";
  return suggestion.effort === undefined ? model : `${model} · ${suggestion.effort}`;
}

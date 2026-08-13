import { describe, expect, it } from "vite-plus/test";

import {
  resolveTaskSuggestionCardState,
  taskSuggestionConcurrencyPresentation,
  taskSuggestionRecommendationLabel,
} from "./TaskSuggestionCard.logic";

describe("task suggestion card state", () => {
  it("maps pending suggestions to accept and dismiss actions", () => {
    expect(resolveTaskSuggestionCardState({ status: "pending" })).toEqual({
      primaryAction: "accept",
      secondaryAction: "dismiss",
      statusLabel: null,
    });
  });

  it("maps dismissed suggestions to restore", () => {
    expect(resolveTaskSuggestionCardState({ status: "dismissed" })).toEqual({
      primaryAction: "restore",
      secondaryAction: null,
      statusLabel: "Dismissed",
    });
  });

  it("only opens accepted suggestions that have a thread", () => {
    expect(
      resolveTaskSuggestionCardState({ status: "accepted", acceptedThreadId: "thread-2" as never }),
    ).toMatchObject({ primaryAction: "open", statusLabel: "Accepted" });
    expect(resolveTaskSuggestionCardState({ status: "accepted" })).toMatchObject({
      primaryAction: null,
      statusLabel: "Accepted",
    });
  });

  it("keeps the concurrency verdict and recommendation plain", () => {
    expect(
      taskSuggestionConcurrencyPresentation({
        concurrency: "run-solo",
        soloReason: "Updates the shared migration table.",
      }),
    ).toEqual({
      label: "Run solo — touches shared state",
      tooltip: "Updates the shared migration table.",
      warning: true,
    });
    expect(taskSuggestionRecommendationLabel({ model: "gpt-5.6-sol", effort: "high" })).toBe(
      "gpt-5.6-sol · high",
    );
  });
});

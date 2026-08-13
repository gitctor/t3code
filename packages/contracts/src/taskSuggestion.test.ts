import { describe, expect, it } from "@effect/vitest";
import * as Schema from "effect/Schema";

import { TaskSuggestion, TaskSuggestionCreateCommand, TaskSuggestions } from "./taskSuggestion.ts";

const suggestion = {
  suggestionId: "suggestion-1",
  environmentId: "environment-1",
  sourceThreadId: "thread-1",
  sourceTurnId: "turn-1",
  title: "Review the persistence migration",
  prompt: "Review the task suggestion migration and focused tests.",
  instanceId: "codex",
  model: "gpt-5.6-sol",
  effort: "high",
  concurrency: "run-solo",
  soloReason: "Touches shared SQLite projection state",
  status: "pending",
  createdAt: "2026-08-12T12:00:00.000Z",
} as const;

describe("TaskSuggestion contracts", () => {
  it("round-trips a suggestion and keeps optional recommendations", () => {
    const decode = Schema.decodeUnknownSync(TaskSuggestion);
    const encode = Schema.encodeSync(TaskSuggestion);

    expect(decode(encode(decode(suggestion)))).toEqual(suggestion);
  });

  it("accepts forward fields and isolates malformed array entries", () => {
    const decoded = Schema.decodeUnknownSync(TaskSuggestions)([
      { ...suggestion, futureDisposition: "delegated" },
      { ...suggestion, suggestionId: "suggestion-2", title: "x".repeat(81) },
    ]);

    expect(decoded).toEqual([suggestion]);
  });

  it("round-trips the internal create command", () => {
    const command = {
      type: "suggestion.create",
      commandId: "command-1",
      suggestion,
    } as const;
    const decode = Schema.decodeUnknownSync(TaskSuggestionCreateCommand);
    const encode = Schema.encodeSync(TaskSuggestionCreateCommand);

    expect(decode(encode(decode(command)))).toEqual(command);
  });

  it("enforces title, prompt, and solo-reason limits", () => {
    const decode = Schema.decodeUnknownSync(TaskSuggestion);

    expect(() => decode({ ...suggestion, title: "x".repeat(81) })).toThrow();
    expect(() => decode({ ...suggestion, prompt: "x".repeat(20_001) })).toThrow();
    expect(() => decode({ ...suggestion, soloReason: "x".repeat(121) })).toThrow();
  });
});

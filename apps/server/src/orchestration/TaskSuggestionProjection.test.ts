import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  CommandId,
  EnvironmentId,
  EventId,
  TaskSuggestionId,
  ThreadId,
  TurnId,
  type OrchestrationEvent,
} from "@t3tools/contracts";

import {
  taskSuggestionFromProjection,
  taskSuggestionProjectionRow,
} from "./TaskSuggestionProjection.ts";
import { ProjectionTaskSuggestionRepositoryLive } from "../persistence/Layers/ProjectionTaskSuggestions.ts";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import { ProjectionTaskSuggestionRepository } from "../persistence/Services/ProjectionTaskSuggestions.ts";

const suggestion = {
  suggestionId: TaskSuggestionId.make("suggestion-1"),
  environmentId: EnvironmentId.make("environment-1"),
  sourceThreadId: ThreadId.make("thread-1"),
  sourceTurnId: TurnId.make("turn-1"),
  title: "Review the focused tests",
  prompt: "Review the focused task suggestion tests.",
  concurrency: "parallel-safe" as const,
  status: "pending" as const,
  createdAt: "2026-08-12T12:00:00.000Z",
};

function event<T extends "suggestion.created" | "suggestion.dismissed">(
  type: T,
  nextSuggestion: OrchestrationEvent["payload"] extends never
    ? never
    : typeof suggestion = suggestion,
): OrchestrationEvent {
  return {
    type,
    sequence: 1,
    eventId: EventId.make("event-1"),
    aggregateKind: "suggestion",
    aggregateId: suggestion.suggestionId,
    occurredAt: suggestion.createdAt,
    commandId: CommandId.make("command-1"),
    causationEventId: null,
    correlationId: null,
    metadata: {},
    payload: { suggestion: nextSuggestion },
  } as unknown as OrchestrationEvent;
}

describe("taskSuggestionProjectionRow", () => {
  it("maps omitted recommendations to nullable SQLite fields", () => {
    const row = taskSuggestionProjectionRow(event("suggestion.created") as never);
    expect(row).toEqual({
      suggestionId: suggestion.suggestionId,
      environmentId: suggestion.environmentId,
      sourceThreadId: suggestion.sourceThreadId,
      sourceTurnId: suggestion.sourceTurnId,
      title: suggestion.title,
      prompt: suggestion.prompt,
      instanceId: null,
      model: null,
      effort: null,
      concurrency: "parallel-safe",
      soloReason: null,
      status: "pending",
      createdAt: suggestion.createdAt,
      resolvedAt: null,
      acceptedThreadId: null,
    });
    expect(taskSuggestionFromProjection(row)).toEqual(suggestion);
  });

  it("maps dismissed lifecycle state for idempotent upsert", () => {
    const dismissed = {
      ...suggestion,
      status: "dismissed" as const,
      resolvedAt: "2026-08-12T12:05:00.000Z",
    };
    expect(
      taskSuggestionProjectionRow(
        event("suggestion.dismissed", dismissed as unknown as typeof suggestion) as never,
      ),
    ).toMatchObject({
      status: "dismissed",
      resolvedAt: dismissed.resolvedAt,
    });
  });

  it.effect("persists lifecycle rows and lists pending suggestions first", () =>
    Effect.gen(function* () {
      const repository = yield* ProjectionTaskSuggestionRepository;
      const first = taskSuggestionProjectionRow(event("suggestion.created") as never);
      const dismissedSuggestion = {
        ...suggestion,
        suggestionId: TaskSuggestionId.make("suggestion-2"),
        status: "dismissed" as const,
        resolvedAt: "2026-08-12T12:05:00.000Z",
      };
      const second = taskSuggestionProjectionRow(
        event("suggestion.dismissed", dismissedSuggestion as unknown as typeof suggestion) as never,
      );

      yield* repository.upsert(second);
      yield* repository.upsert(first);

      const rows = yield* repository.list({
        environmentId: suggestion.environmentId,
        status: null,
        sourceThreadId: suggestion.sourceThreadId,
      });
      expect(rows.map((row) => [row.suggestionId, row.status])).toEqual([
        [suggestion.suggestionId, "pending"],
        [dismissedSuggestion.suggestionId, "dismissed"],
      ]);
      expect(
        yield* repository.countPendingBySourceThread({
          environmentId: suggestion.environmentId,
          sourceThreadId: suggestion.sourceThreadId,
        }),
      ).toBe(1);
    }).pipe(
      Effect.provide(
        ProjectionTaskSuggestionRepositoryLive.pipe(Layer.provide(SqlitePersistenceMemory)),
      ),
    ),
  );
});

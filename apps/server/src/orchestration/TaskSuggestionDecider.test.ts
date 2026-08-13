import { assert, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { CommandId, EnvironmentId, TaskSuggestionId, ThreadId, TurnId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { decideOrchestrationCommand } from "./decider.ts";

const createdAt = "2026-08-12T12:00:00.000Z";
const suggestion = {
  suggestionId: TaskSuggestionId.make("suggestion-1"),
  environmentId: EnvironmentId.make("environment-1"),
  sourceThreadId: ThreadId.make("thread-1"),
  sourceTurnId: TurnId.make("turn-1"),
  title: "Review the migration",
  prompt: "Review the task suggestion migration.",
  concurrency: "parallel-safe" as const,
  status: "pending" as const,
  createdAt,
};

const readModel = {
  snapshotSequence: 0,
  updatedAt: createdAt,
  projects: [],
  threads: [],
};

it.effect("emits suggestion lifecycle events through the decider", () =>
  Effect.gen(function* () {
    const created = yield* decideOrchestrationCommand({
      command: {
        type: "suggestion.create",
        commandId: CommandId.make("command-create"),
        suggestion,
      },
      readModel,
    });
    if (!("type" in created)) return assert.fail("expected suggestion.created event");
    assert.equal(created.type, "suggestion.created");
    assert.equal(created.aggregateKind, "suggestion");
    assert.equal(created.aggregateId, suggestion.suggestionId);

    const acceptedSuggestion = {
      ...suggestion,
      status: "accepted" as const,
      resolvedAt: "2026-08-12T12:05:00.000Z",
      acceptedThreadId: ThreadId.make("thread-accepted"),
    };
    const accepted = yield* decideOrchestrationCommand({
      command: {
        type: "suggestion.accept",
        commandId: CommandId.make("command-accept"),
        suggestion: acceptedSuggestion,
      },
      readModel,
    });
    if (!("type" in accepted)) return assert.fail("expected suggestion.accepted event");
    assert.equal(accepted.type, "suggestion.accepted");
    assert.deepEqual(accepted.payload, { suggestion: acceptedSuggestion });

    const dismissedSuggestion = {
      ...suggestion,
      status: "dismissed" as const,
      resolvedAt: "2026-08-12T12:06:00.000Z",
    };
    const dismissed = yield* decideOrchestrationCommand({
      command: {
        type: "suggestion.dismiss",
        commandId: CommandId.make("command-dismiss"),
        suggestion: dismissedSuggestion,
      },
      readModel,
    });
    if (!("type" in dismissed)) return assert.fail("expected suggestion.dismissed event");
    assert.equal(dismissed.type, "suggestion.dismissed");

    const restored = yield* decideOrchestrationCommand({
      command: {
        type: "suggestion.restore",
        commandId: CommandId.make("command-restore"),
        suggestion,
        restoredAt: "2026-08-12T12:07:00.000Z",
      },
      readModel,
    });
    if (!("type" in restored)) return assert.fail("expected suggestion.restored event");
    assert.equal(restored.type, "suggestion.restored");
    assert.deepEqual(restored.payload, { suggestion });
  }).pipe(Effect.provide(NodeServices.layer)),
);

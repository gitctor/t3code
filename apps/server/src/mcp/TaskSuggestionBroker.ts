import {
  CommandId,
  TaskSuggestionError,
  TaskSuggestionId,
  type SuggestTaskInput,
  type SuggestTaskResult,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Semaphore from "effect/Semaphore";

import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ProjectionTaskSuggestionRepository } from "../persistence/Services/ProjectionTaskSuggestions.ts";
import type { McpInvocationScope } from "./McpInvocationContext.ts";

export const MAX_PENDING_TASK_SUGGESTIONS_PER_THREAD = 10;

export interface TaskSuggestionBrokerShape {
  readonly suggest: (
    scope: McpInvocationScope,
    input: SuggestTaskInput,
  ) => Effect.Effect<SuggestTaskResult, TaskSuggestionError>;
}

export class TaskSuggestionBroker extends Context.Service<
  TaskSuggestionBroker,
  TaskSuggestionBrokerShape
>()("t3/mcp/TaskSuggestionBroker") {}

const suggestionError = (code: TaskSuggestionError["code"], message: string): TaskSuggestionError =>
  new TaskSuggestionError({ code, message });

export const make = Effect.gen(function* () {
  const crypto = yield* Crypto.Crypto;
  const engine = yield* OrchestrationEngineService;
  const projection = yield* ProjectionTaskSuggestionRepository;
  const snapshots = yield* ProjectionSnapshotQuery;
  const createSemaphore = yield* Semaphore.make(1);

  const suggestUnlocked = Effect.fn("TaskSuggestionBroker.suggestUnlocked")(function* (
    scope: McpInvocationScope,
    input: SuggestTaskInput,
  ) {
    const thread = yield* snapshots.getThreadDetailById(scope.threadId).pipe(
      Effect.map(Option.getOrUndefined),
      Effect.mapError(() =>
        suggestionError("source-turn-unavailable", "The source turn is unavailable."),
      ),
    );
    const sourceTurnId = thread?.session?.activeTurnId;
    if (
      thread?.session?.status !== "running" ||
      sourceTurnId === null ||
      sourceTurnId === undefined ||
      (thread.session.providerInstanceId !== undefined &&
        thread.session.providerInstanceId !== scope.providerInstanceId)
    ) {
      return yield* suggestionError(
        "source-turn-unavailable",
        "Task suggestions require an active source turn.",
      );
    }

    const pendingCount = yield* projection
      .countPendingBySourceThread({
        environmentId: scope.environmentId,
        sourceThreadId: scope.threadId,
      })
      .pipe(
        Effect.mapError(() =>
          suggestionError("source-turn-unavailable", "Task suggestion state is unavailable."),
        ),
      );
    if (pendingCount >= MAX_PENDING_TASK_SUGGESTIONS_PER_THREAD) {
      return yield* suggestionError(
        "pending-limit-reached",
        `This thread already has ${MAX_PENDING_TASK_SUGGESTIONS_PER_THREAD} pending suggestions.`,
      );
    }

    const createdAt = DateTime.formatIso(yield* DateTime.now);
    const suggestionId = TaskSuggestionId.make(yield* crypto.randomUUIDv4.pipe(Effect.orDie));
    const suggestion = {
      suggestionId,
      environmentId: scope.environmentId,
      sourceThreadId: scope.threadId,
      sourceTurnId,
      title: input.title,
      prompt: input.prompt,
      ...(input.instanceId !== undefined ? { instanceId: input.instanceId } : {}),
      ...(input.model !== undefined ? { model: input.model } : {}),
      ...(input.effort !== undefined ? { effort: input.effort } : {}),
      concurrency: input.concurrency,
      ...(input.soloReason !== undefined ? { soloReason: input.soloReason } : {}),
      status: "pending" as const,
      createdAt,
    };

    yield* engine
      .dispatch({
        type: "suggestion.create",
        commandId: CommandId.make(`server:suggestion:create:${suggestionId}`),
        suggestion,
      })
      .pipe(
        Effect.mapError(() =>
          suggestionError("source-turn-unavailable", "The task suggestion could not be saved."),
        ),
      );

    return { suggestion } satisfies SuggestTaskResult;
  });

  return TaskSuggestionBroker.of({
    suggest: (scope, input) => createSemaphore.withPermits(1)(suggestUnlocked(scope, input)),
  });
});

export const layer = Layer.effect(TaskSuggestionBroker, make);

export const unavailableLayer = Layer.succeed(
  TaskSuggestionBroker,
  TaskSuggestionBroker.of({
    suggest: Effect.fn("TaskSuggestionBroker.unavailable.suggest")(function* () {
      return yield* suggestionError("capability-unavailable", "Task suggestions are unavailable.");
    }),
  }),
);

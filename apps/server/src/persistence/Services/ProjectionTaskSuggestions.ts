import {
  EnvironmentId,
  IsoDateTime,
  ProviderInstanceId,
  TaskSuggestionConcurrency,
  TaskSuggestionId,
  TaskSuggestionStatus,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { ProjectionRepositoryError } from "../Errors.ts";

export const ProjectionTaskSuggestion = Schema.Struct({
  suggestionId: TaskSuggestionId,
  environmentId: EnvironmentId,
  sourceThreadId: ThreadId,
  sourceTurnId: TurnId,
  title: Schema.String,
  prompt: Schema.String,
  instanceId: Schema.NullOr(ProviderInstanceId),
  model: Schema.NullOr(Schema.String),
  effort: Schema.NullOr(Schema.String),
  concurrency: TaskSuggestionConcurrency,
  soloReason: Schema.NullOr(Schema.String),
  status: TaskSuggestionStatus,
  createdAt: IsoDateTime,
  resolvedAt: Schema.NullOr(IsoDateTime),
  acceptedThreadId: Schema.NullOr(ThreadId),
});
export type ProjectionTaskSuggestion = typeof ProjectionTaskSuggestion.Type;

export const GetProjectionTaskSuggestionInput = Schema.Struct({
  suggestionId: TaskSuggestionId,
});
export const ListProjectionTaskSuggestionsInput = Schema.Struct({
  environmentId: EnvironmentId,
  status: Schema.NullOr(TaskSuggestionStatus),
  sourceThreadId: Schema.NullOr(ThreadId),
});
export const CountPendingProjectionTaskSuggestionsInput = Schema.Struct({
  environmentId: EnvironmentId,
  sourceThreadId: ThreadId,
});

export interface ProjectionTaskSuggestionRepositoryShape {
  readonly upsert: (
    row: ProjectionTaskSuggestion,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly getById: (
    input: typeof GetProjectionTaskSuggestionInput.Type,
  ) => Effect.Effect<Option.Option<ProjectionTaskSuggestion>, ProjectionRepositoryError>;
  readonly list: (
    input: typeof ListProjectionTaskSuggestionsInput.Type,
  ) => Effect.Effect<ReadonlyArray<ProjectionTaskSuggestion>, ProjectionRepositoryError>;
  readonly countPendingBySourceThread: (
    input: typeof CountPendingProjectionTaskSuggestionsInput.Type,
  ) => Effect.Effect<number, ProjectionRepositoryError>;
}

export class ProjectionTaskSuggestionRepository extends Context.Service<
  ProjectionTaskSuggestionRepository,
  ProjectionTaskSuggestionRepositoryShape
>()("t3/persistence/Services/ProjectionTaskSuggestions/ProjectionTaskSuggestionRepository") {}

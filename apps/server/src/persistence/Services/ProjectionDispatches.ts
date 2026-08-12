import {
  DispatchId,
  DispatchStatus,
  IsoDateTime,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { ProjectionRepositoryError } from "../Errors.ts";

export const ProjectionDispatch = Schema.Struct({
  dispatchId: DispatchId,
  parentThreadId: ThreadId,
  parentTurnId: TurnId,
  childThreadId: Schema.NullOr(ThreadId),
  instanceId: ProviderInstanceId,
  provider: ProviderDriverKind,
  model: Schema.NullOr(Schema.String),
  role: Schema.NullOr(Schema.String),
  title: Schema.String,
  effort: Schema.NullOr(Schema.String),
  status: DispatchStatus,
  reason: Schema.NullOr(Schema.String),
  summary: Schema.NullOr(Schema.String),
  startedAt: IsoDateTime,
  settledAt: Schema.NullOr(IsoDateTime),
});
export type ProjectionDispatch = typeof ProjectionDispatch.Type;

export const GetProjectionDispatchInput = Schema.Struct({ dispatchId: DispatchId });
export const ListProjectionDispatchesByParentTurnInput = Schema.Struct({
  parentThreadId: ThreadId,
  parentTurnId: TurnId,
});
export const ListProjectionDispatchesByParentThreadInput = Schema.Struct({
  parentThreadId: ThreadId,
});
export const GetProjectionDispatchByChildThreadInput = Schema.Struct({ childThreadId: ThreadId });

export interface ProjectionDispatchRepositoryShape {
  readonly upsert: (row: ProjectionDispatch) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly getById: (
    input: typeof GetProjectionDispatchInput.Type,
  ) => Effect.Effect<Option.Option<ProjectionDispatch>, ProjectionRepositoryError>;
  readonly getByChildThreadId: (
    input: typeof GetProjectionDispatchByChildThreadInput.Type,
  ) => Effect.Effect<Option.Option<ProjectionDispatch>, ProjectionRepositoryError>;
  readonly listByParentTurn: (
    input: typeof ListProjectionDispatchesByParentTurnInput.Type,
  ) => Effect.Effect<ReadonlyArray<ProjectionDispatch>, ProjectionRepositoryError>;
  readonly listUnsettledByParentThread: (
    input: typeof ListProjectionDispatchesByParentThreadInput.Type,
  ) => Effect.Effect<ReadonlyArray<ProjectionDispatch>, ProjectionRepositoryError>;
  readonly listUnsettled: Effect.Effect<
    ReadonlyArray<ProjectionDispatch>,
    ProjectionRepositoryError
  >;
}

export class ProjectionDispatchRepository extends Context.Service<
  ProjectionDispatchRepository,
  ProjectionDispatchRepositoryShape
>()("t3/persistence/Services/ProjectionDispatches/ProjectionDispatchRepository") {}

import {
  EnvironmentId,
  IsoDateTime,
  MessageId,
  ThreadId,
  ThreadMessageStatus,
  TurnId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { ProjectionRepositoryError } from "../Errors.ts";

export const ProjectionCrossThreadMessage = Schema.Struct({
  messageId: MessageId,
  environmentId: EnvironmentId,
  sourceThreadId: ThreadId,
  sourceTurnId: TurnId,
  targetThreadId: ThreadId,
  body: Schema.String,
  status: ThreadMessageStatus,
  reason: Schema.NullOr(Schema.String),
  createdAt: IsoDateTime,
  deliveredAt: Schema.NullOr(IsoDateTime),
});
export type ProjectionCrossThreadMessage = typeof ProjectionCrossThreadMessage.Type;

export const GetProjectionCrossThreadMessageInput = Schema.Struct({ messageId: MessageId });
export const ListQueuedCrossThreadMessagesByTargetInput = Schema.Struct({
  environmentId: EnvironmentId,
  targetThreadId: ThreadId,
});
export const CountCrossThreadMessagesBySourceTurnInput = Schema.Struct({
  environmentId: EnvironmentId,
  sourceThreadId: ThreadId,
  sourceTurnId: TurnId,
});

export interface ProjectionCrossThreadMessageRepositoryShape {
  readonly upsert: (
    row: ProjectionCrossThreadMessage,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly getById: (
    input: typeof GetProjectionCrossThreadMessageInput.Type,
  ) => Effect.Effect<Option.Option<ProjectionCrossThreadMessage>, ProjectionRepositoryError>;
  readonly listQueuedByTarget: (
    input: typeof ListQueuedCrossThreadMessagesByTargetInput.Type,
  ) => Effect.Effect<ReadonlyArray<ProjectionCrossThreadMessage>, ProjectionRepositoryError>;
  readonly listQueued: Effect.Effect<
    ReadonlyArray<ProjectionCrossThreadMessage>,
    ProjectionRepositoryError
  >;
  readonly countBySourceTurn: (
    input: typeof CountCrossThreadMessagesBySourceTurnInput.Type,
  ) => Effect.Effect<number, ProjectionRepositoryError>;
}

export class ProjectionCrossThreadMessageRepository extends Context.Service<
  ProjectionCrossThreadMessageRepository,
  ProjectionCrossThreadMessageRepositoryShape
>()(
  "t3/persistence/Services/ProjectionCrossThreadMessages/ProjectionCrossThreadMessageRepository",
) {}

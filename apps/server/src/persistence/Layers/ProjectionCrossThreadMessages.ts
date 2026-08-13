import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import { toPersistenceDecodeError, toPersistenceSqlError } from "../Errors.ts";
import {
  CountCrossThreadMessagesBySourceTurnInput,
  GetProjectionCrossThreadMessageInput,
  ListQueuedCrossThreadMessagesByTargetInput,
  ProjectionCrossThreadMessage,
  ProjectionCrossThreadMessageRepository,
  type ProjectionCrossThreadMessageRepositoryShape,
} from "../Services/ProjectionCrossThreadMessages.ts";

const CountRow = Schema.Struct({ count: Schema.Number });

const makeProjectionCrossThreadMessageRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const selectColumns = sql`
    message_id AS "messageId",
    environment_id AS "environmentId",
    source_thread_id AS "sourceThreadId",
    source_turn_id AS "sourceTurnId",
    target_thread_id AS "targetThreadId",
    body,
    status,
    reason,
    created_at AS "createdAt",
    delivered_at AS "deliveredAt"
  `;

  const upsertRow = SqlSchema.void({
    Request: ProjectionCrossThreadMessage,
    execute: (row) => sql`
      INSERT INTO projection_cross_thread_messages (
        message_id, environment_id, source_thread_id, source_turn_id,
        target_thread_id, body, status, reason, created_at, delivered_at
      ) VALUES (
        ${row.messageId}, ${row.environmentId}, ${row.sourceThreadId}, ${row.sourceTurnId},
        ${row.targetThreadId}, ${row.body}, ${row.status}, ${row.reason}, ${row.createdAt},
        ${row.deliveredAt}
      )
      ON CONFLICT (message_id) DO UPDATE SET
        environment_id = excluded.environment_id,
        source_thread_id = excluded.source_thread_id,
        source_turn_id = excluded.source_turn_id,
        target_thread_id = excluded.target_thread_id,
        body = excluded.body,
        status = excluded.status,
        reason = excluded.reason,
        created_at = excluded.created_at,
        delivered_at = excluded.delivered_at
    `,
  });

  const getRow = SqlSchema.findOneOption({
    Request: GetProjectionCrossThreadMessageInput,
    Result: ProjectionCrossThreadMessage,
    execute: ({ messageId }) => sql`
      SELECT ${selectColumns}
      FROM projection_cross_thread_messages
      WHERE message_id = ${messageId}
      LIMIT 1
    `,
  });

  const listQueuedRowsByTarget = SqlSchema.findAll({
    Request: ListQueuedCrossThreadMessagesByTargetInput,
    Result: ProjectionCrossThreadMessage,
    execute: ({ environmentId, targetThreadId }) => sql`
      SELECT ${selectColumns}
      FROM projection_cross_thread_messages
      WHERE environment_id = ${environmentId}
        AND target_thread_id = ${targetThreadId}
        AND status = 'queued'
      ORDER BY created_at ASC, message_id ASC
    `,
  });

  const listQueuedRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionCrossThreadMessage,
    execute: () => sql`
      SELECT ${selectColumns}
      FROM projection_cross_thread_messages
      WHERE status = 'queued'
      ORDER BY target_thread_id ASC, created_at ASC, message_id ASC
    `,
  });

  const countRows = SqlSchema.findOne({
    Request: CountCrossThreadMessagesBySourceTurnInput,
    Result: CountRow,
    execute: ({ environmentId, sourceThreadId, sourceTurnId }) => sql`
      SELECT COUNT(*) AS count
      FROM projection_cross_thread_messages
      WHERE environment_id = ${environmentId}
        AND source_thread_id = ${sourceThreadId}
        AND source_turn_id = ${sourceTurnId}
    `,
  });

  const mapError = (operation: string) =>
    Effect.mapError((cause) =>
      Schema.isSchemaError(cause)
        ? toPersistenceDecodeError(`${operation}:decode`)(cause)
        : toPersistenceSqlError(`${operation}:query`)(cause),
    );

  return ProjectionCrossThreadMessageRepository.of({
    upsert: (row) => upsertRow(row).pipe(mapError("ProjectionCrossThreadMessages.upsert")),
    getById: (input) => getRow(input).pipe(mapError("ProjectionCrossThreadMessages.getById")),
    listQueuedByTarget: (input) =>
      listQueuedRowsByTarget(input).pipe(
        mapError("ProjectionCrossThreadMessages.listQueuedByTarget"),
      ),
    listQueued: listQueuedRows(undefined).pipe(
      mapError("ProjectionCrossThreadMessages.listQueued"),
    ),
    countBySourceTurn: (input) =>
      countRows(input).pipe(
        Effect.map((row) => row.count),
        mapError("ProjectionCrossThreadMessages.countBySourceTurn"),
      ),
  } satisfies ProjectionCrossThreadMessageRepositoryShape);
});

export const ProjectionCrossThreadMessageRepositoryLive = Layer.effect(
  ProjectionCrossThreadMessageRepository,
  makeProjectionCrossThreadMessageRepository,
);

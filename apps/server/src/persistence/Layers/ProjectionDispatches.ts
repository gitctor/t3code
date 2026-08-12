import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import { toPersistenceDecodeError, toPersistenceSqlError } from "../Errors.ts";
import {
  GetProjectionDispatchByChildThreadInput,
  GetProjectionDispatchInput,
  ListProjectionDispatchesByParentThreadInput,
  ListProjectionDispatchesByParentTurnInput,
  ProjectionDispatch,
  ProjectionDispatchRepository,
  type ProjectionDispatchRepositoryShape,
} from "../Services/ProjectionDispatches.ts";

const toPersistenceSqlOrDecodeError =
  (sqlOperation: string, decodeOperation: string) => (cause: unknown) =>
    Schema.isSchemaError(cause)
      ? toPersistenceDecodeError(decodeOperation)(cause)
      : toPersistenceSqlError(sqlOperation)(cause);

const makeProjectionDispatchRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertRow = SqlSchema.void({
    Request: ProjectionDispatch,
    execute: (row) => sql`
      INSERT INTO projection_dispatches (
        dispatch_id, parent_thread_id, parent_turn_id, child_thread_id,
        instance_id, provider, model, role, title, effort, status, reason,
        summary, started_at, settled_at
      ) VALUES (
        ${row.dispatchId}, ${row.parentThreadId}, ${row.parentTurnId}, ${row.childThreadId},
        ${row.instanceId}, ${row.provider}, ${row.model}, ${row.role}, ${row.title},
        ${row.effort}, ${row.status}, ${row.reason}, ${row.summary}, ${row.startedAt},
        ${row.settledAt}
      )
      ON CONFLICT (dispatch_id) DO UPDATE SET
        parent_thread_id = excluded.parent_thread_id,
        parent_turn_id = excluded.parent_turn_id,
        child_thread_id = excluded.child_thread_id,
        instance_id = excluded.instance_id,
        provider = excluded.provider,
        model = excluded.model,
        role = excluded.role,
        title = excluded.title,
        effort = excluded.effort,
        status = excluded.status,
        reason = excluded.reason,
        summary = excluded.summary,
        started_at = excluded.started_at,
        settled_at = excluded.settled_at
    `,
  });

  const selectColumns = sql`
    dispatch_id AS "dispatchId",
    parent_thread_id AS "parentThreadId",
    parent_turn_id AS "parentTurnId",
    child_thread_id AS "childThreadId",
    instance_id AS "instanceId",
    provider,
    model,
    role,
    title,
    effort,
    status,
    reason,
    summary,
    started_at AS "startedAt",
    settled_at AS "settledAt"
  `;

  const getRowById = SqlSchema.findOneOption({
    Request: GetProjectionDispatchInput,
    Result: ProjectionDispatch,
    execute: ({ dispatchId }) => sql`
      SELECT ${selectColumns}
      FROM projection_dispatches
      WHERE dispatch_id = ${dispatchId}
      LIMIT 1
    `,
  });

  const getRowByChildThreadId = SqlSchema.findOneOption({
    Request: GetProjectionDispatchByChildThreadInput,
    Result: ProjectionDispatch,
    execute: ({ childThreadId }) => sql`
      SELECT ${selectColumns}
      FROM projection_dispatches
      WHERE child_thread_id = ${childThreadId}
      LIMIT 1
    `,
  });

  const listRowsByParentTurn = SqlSchema.findAll({
    Request: ListProjectionDispatchesByParentTurnInput,
    Result: ProjectionDispatch,
    execute: ({ parentThreadId, parentTurnId }) => sql`
      SELECT ${selectColumns}
      FROM projection_dispatches
      WHERE parent_thread_id = ${parentThreadId}
        AND parent_turn_id = ${parentTurnId}
      ORDER BY started_at ASC, dispatch_id ASC
    `,
  });

  const listUnsettledRowsByParentThread = SqlSchema.findAll({
    Request: ListProjectionDispatchesByParentThreadInput,
    Result: ProjectionDispatch,
    execute: ({ parentThreadId }) => sql`
      SELECT ${selectColumns}
      FROM projection_dispatches
      WHERE parent_thread_id = ${parentThreadId}
        AND status IN ('queued', 'running')
      ORDER BY started_at ASC, dispatch_id ASC
    `,
  });

  const listUnsettledRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionDispatch,
    execute: () => sql`
      SELECT ${selectColumns}
      FROM projection_dispatches
      WHERE status IN ('queued', 'running')
      ORDER BY started_at ASC, dispatch_id ASC
    `,
  });

  const mapError = (operation: string) =>
    Effect.mapError(toPersistenceSqlOrDecodeError(`${operation}:query`, `${operation}:decode`));

  return ProjectionDispatchRepository.of({
    upsert: (row) => upsertRow(row).pipe(mapError("ProjectionDispatchRepository.upsert")),
    getById: (input) => getRowById(input).pipe(mapError("ProjectionDispatchRepository.getById")),
    getByChildThreadId: (input) =>
      getRowByChildThreadId(input).pipe(
        mapError("ProjectionDispatchRepository.getByChildThreadId"),
      ),
    listByParentTurn: (input) =>
      listRowsByParentTurn(input).pipe(mapError("ProjectionDispatchRepository.listByParentTurn")),
    listUnsettledByParentThread: (input) =>
      listUnsettledRowsByParentThread(input).pipe(
        mapError("ProjectionDispatchRepository.listUnsettledByParentThread"),
      ),
    listUnsettled: listUnsettledRows(undefined).pipe(
      mapError("ProjectionDispatchRepository.listUnsettled"),
    ),
  } satisfies ProjectionDispatchRepositoryShape);
});

export const ProjectionDispatchRepositoryLive = Layer.effect(
  ProjectionDispatchRepository,
  makeProjectionDispatchRepository,
);

import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import { toPersistenceDecodeError, toPersistenceSqlError } from "../Errors.ts";
import {
  CountPendingProjectionTaskSuggestionsInput,
  GetProjectionTaskSuggestionInput,
  ListProjectionTaskSuggestionsInput,
  ProjectionTaskSuggestion,
  ProjectionTaskSuggestionRepository,
  type ProjectionTaskSuggestionRepositoryShape,
} from "../Services/ProjectionTaskSuggestions.ts";

const CountRow = Schema.Struct({ count: Schema.Number });

const makeProjectionTaskSuggestionRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const selectColumns = sql`
    suggestion_id AS "suggestionId",
    environment_id AS "environmentId",
    source_thread_id AS "sourceThreadId",
    source_turn_id AS "sourceTurnId",
    title,
    prompt,
    instance_id AS "instanceId",
    model,
    effort,
    concurrency,
    solo_reason AS "soloReason",
    status,
    created_at AS "createdAt",
    resolved_at AS "resolvedAt",
    accepted_thread_id AS "acceptedThreadId"
  `;

  const upsertRow = SqlSchema.void({
    Request: ProjectionTaskSuggestion,
    execute: (row) => sql`
      INSERT INTO projection_task_suggestions (
        suggestion_id, environment_id, source_thread_id, source_turn_id, title, prompt,
        instance_id, model, effort, concurrency, solo_reason, status, created_at,
        resolved_at, accepted_thread_id
      ) VALUES (
        ${row.suggestionId}, ${row.environmentId}, ${row.sourceThreadId}, ${row.sourceTurnId},
        ${row.title}, ${row.prompt}, ${row.instanceId}, ${row.model}, ${row.effort},
        ${row.concurrency}, ${row.soloReason}, ${row.status}, ${row.createdAt},
        ${row.resolvedAt}, ${row.acceptedThreadId}
      )
      ON CONFLICT (suggestion_id) DO UPDATE SET
        environment_id = excluded.environment_id,
        source_thread_id = excluded.source_thread_id,
        source_turn_id = excluded.source_turn_id,
        title = excluded.title,
        prompt = excluded.prompt,
        instance_id = excluded.instance_id,
        model = excluded.model,
        effort = excluded.effort,
        concurrency = excluded.concurrency,
        solo_reason = excluded.solo_reason,
        status = excluded.status,
        created_at = excluded.created_at,
        resolved_at = excluded.resolved_at,
        accepted_thread_id = excluded.accepted_thread_id
    `,
  });

  const getRow = SqlSchema.findOneOption({
    Request: GetProjectionTaskSuggestionInput,
    Result: ProjectionTaskSuggestion,
    execute: ({ suggestionId }) => sql`
      SELECT ${selectColumns}
      FROM projection_task_suggestions
      WHERE suggestion_id = ${suggestionId}
      LIMIT 1
    `,
  });

  const listRows = SqlSchema.findAll({
    Request: ListProjectionTaskSuggestionsInput,
    Result: ProjectionTaskSuggestion,
    execute: ({ environmentId, status, sourceThreadId }) => sql`
      SELECT ${selectColumns}
      FROM projection_task_suggestions
      WHERE environment_id = ${environmentId}
        AND (${status} IS NULL OR status = ${status})
        AND (${sourceThreadId} IS NULL OR source_thread_id = ${sourceThreadId})
      ORDER BY CASE status WHEN 'pending' THEN 0 WHEN 'dismissed' THEN 1 ELSE 2 END,
               created_at DESC,
               suggestion_id ASC
    `,
  });

  const countPendingRows = SqlSchema.findOne({
    Request: CountPendingProjectionTaskSuggestionsInput,
    Result: CountRow,
    execute: ({ environmentId, sourceThreadId }) => sql`
      SELECT COUNT(*) AS count
      FROM projection_task_suggestions
      WHERE environment_id = ${environmentId}
        AND source_thread_id = ${sourceThreadId}
        AND status = 'pending'
    `,
  });

  const mapError = (operation: string) =>
    Effect.mapError((cause) =>
      Schema.isSchemaError(cause)
        ? toPersistenceDecodeError(`${operation}:decode`)(cause)
        : toPersistenceSqlError(`${operation}:query`)(cause),
    );

  return ProjectionTaskSuggestionRepository.of({
    upsert: (row) => upsertRow(row).pipe(mapError("ProjectionTaskSuggestionRepository.upsert")),
    getById: (input) => getRow(input).pipe(mapError("ProjectionTaskSuggestionRepository.getById")),
    list: (input) => listRows(input).pipe(mapError("ProjectionTaskSuggestionRepository.list")),
    countPendingBySourceThread: (input) =>
      countPendingRows(input).pipe(
        Effect.map((row) => row.count),
        mapError("ProjectionTaskSuggestionRepository.countPendingBySourceThread"),
      ),
  } satisfies ProjectionTaskSuggestionRepositoryShape);
});

export const ProjectionTaskSuggestionRepositoryLive = Layer.effect(
  ProjectionTaskSuggestionRepository,
  makeProjectionTaskSuggestionRepository,
);

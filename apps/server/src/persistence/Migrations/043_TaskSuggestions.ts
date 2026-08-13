import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE projection_task_suggestions (
      suggestion_id TEXT PRIMARY KEY,
      environment_id TEXT NOT NULL,
      source_thread_id TEXT NOT NULL,
      source_turn_id TEXT NOT NULL,
      title TEXT NOT NULL,
      prompt TEXT NOT NULL,
      instance_id TEXT,
      model TEXT,
      effort TEXT,
      concurrency TEXT NOT NULL,
      solo_reason TEXT,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      resolved_at TEXT,
      accepted_thread_id TEXT
    )
  `;

  yield* sql`
    CREATE INDEX idx_projection_task_suggestions_environment_status
    ON projection_task_suggestions(environment_id, status, created_at)
  `;

  yield* sql`
    CREATE INDEX idx_projection_task_suggestions_source_thread
    ON projection_task_suggestions(environment_id, source_thread_id, status, created_at)
  `;
});

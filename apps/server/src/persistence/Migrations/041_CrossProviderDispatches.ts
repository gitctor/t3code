import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`ALTER TABLE projection_turns ADD COLUMN crew_id TEXT`;

  yield* sql`
    CREATE TABLE projection_dispatches (
      dispatch_id TEXT PRIMARY KEY,
      parent_thread_id TEXT NOT NULL,
      parent_turn_id TEXT NOT NULL,
      child_thread_id TEXT,
      instance_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT,
      role TEXT,
      title TEXT NOT NULL,
      effort TEXT,
      status TEXT NOT NULL,
      reason TEXT,
      summary TEXT,
      started_at TEXT NOT NULL,
      settled_at TEXT
    )
  `;

  yield* sql`
    CREATE INDEX idx_projection_dispatches_parent_turn
    ON projection_dispatches(parent_thread_id, parent_turn_id, started_at)
  `;

  yield* sql`
    CREATE UNIQUE INDEX idx_projection_dispatches_child_thread
    ON projection_dispatches(child_thread_id)
    WHERE child_thread_id IS NOT NULL
  `;

  yield* sql`
    CREATE INDEX idx_projection_dispatches_unsettled
    ON projection_dispatches(status, parent_thread_id)
  `;
});

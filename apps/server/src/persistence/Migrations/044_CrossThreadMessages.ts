import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE projection_cross_thread_messages (
      message_id TEXT PRIMARY KEY,
      environment_id TEXT NOT NULL,
      source_thread_id TEXT NOT NULL,
      source_turn_id TEXT NOT NULL,
      target_thread_id TEXT NOT NULL,
      body TEXT NOT NULL,
      status TEXT NOT NULL,
      reason TEXT,
      created_at TEXT NOT NULL,
      delivered_at TEXT
    )
  `;

  yield* sql`
    CREATE INDEX idx_projection_cross_thread_messages_target_queue
    ON projection_cross_thread_messages(environment_id, target_thread_id, status, created_at, message_id)
  `;

  yield* sql`
    CREATE INDEX idx_projection_cross_thread_messages_source_turn
    ON projection_cross_thread_messages(environment_id, source_thread_id, source_turn_id, created_at)
  `;

  yield* sql`
    ALTER TABLE projection_thread_messages
    ADD COLUMN cross_thread_source_json TEXT
  `;
});

import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("042_ProjectionThreadParents", (it) => {
  it.effect("backfills existing dispatched children and leaves ordinary threads root-level", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 41 });

      yield* sql`
        INSERT INTO projection_threads (
          thread_id, project_id, title, runtime_mode, interaction_mode, created_at, updated_at
        ) VALUES
          ('parent', 'project-1', 'Parent', 'full-access', 'default',
            '2026-08-11T12:00:00.000Z', '2026-08-11T12:00:00.000Z'),
          ('child', 'project-1', 'Child', 'full-access', 'default',
            '2026-08-11T12:01:00.000Z', '2026-08-11T12:01:00.000Z'),
          ('ordinary', 'project-1', 'Ordinary', 'full-access', 'default',
            '2026-08-11T12:02:00.000Z', '2026-08-11T12:02:00.000Z')
      `;
      yield* sql`
        INSERT INTO projection_dispatches (
          dispatch_id, parent_thread_id, parent_turn_id, child_thread_id,
          instance_id, provider, title, status, started_at
        ) VALUES (
          'dispatch-1', 'parent', 'turn-1', 'child',
          'claudeAgent', 'claudeAgent', 'Build', 'running', '2026-08-11T12:01:00.000Z'
        )
      `;

      yield* runMigrations({ toMigrationInclusive: 42 });

      const rows = yield* sql<{
        readonly threadId: string;
        readonly parentThreadId: string | null;
      }>`
        SELECT thread_id AS "threadId", parent_thread_id AS "parentThreadId"
        FROM projection_threads
        ORDER BY thread_id
      `;
      assert.deepStrictEqual(rows, [
        { threadId: "child", parentThreadId: "parent" },
        { threadId: "ordinary", parentThreadId: null },
        { threadId: "parent", parentThreadId: null },
      ]);

      const indexes = yield* sql<{ readonly name: string }>`
        PRAGMA index_list(projection_threads)
      `;
      assert.ok(indexes.some((index) => index.name === "idx_projection_threads_parent_thread"));
    }),
  );
});

import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("041_CrossProviderDispatches", (it) => {
  it.effect("adds crew turn linkage and the durable dispatch projection", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 40 });
      yield* runMigrations({ toMigrationInclusive: 41 });

      const turnColumns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(projection_turns)
      `;
      assert.ok(turnColumns.some((column) => column.name === "crew_id"));

      const dispatchColumns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(projection_dispatches)
      `;
      assert.deepStrictEqual(
        dispatchColumns.map((column) => column.name),
        [
          "dispatch_id",
          "parent_thread_id",
          "parent_turn_id",
          "child_thread_id",
          "instance_id",
          "provider",
          "model",
          "role",
          "title",
          "effort",
          "status",
          "reason",
          "summary",
          "started_at",
          "settled_at",
        ],
      );

      const indexes = yield* sql<{ readonly name: string }>`
        PRAGMA index_list(projection_dispatches)
      `;
      const names = new Set(indexes.map((index) => index.name));
      assert.ok(names.has("idx_projection_dispatches_parent_turn"));
      assert.ok(names.has("idx_projection_dispatches_child_thread"));
      assert.ok(names.has("idx_projection_dispatches_unsettled"));
    }),
  );
});

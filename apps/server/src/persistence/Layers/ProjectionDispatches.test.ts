import { assert, it } from "@effect/vitest";
import {
  CrewId,
  DispatchId,
  MessageId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { ProjectionDispatchRepository } from "../Services/ProjectionDispatches.ts";
import { ProjectionTurnRepository } from "../Services/ProjectionTurns.ts";
import { ProjectionDispatchRepositoryLive } from "./ProjectionDispatches.ts";
import { ProjectionTurnRepositoryLive } from "./ProjectionTurns.ts";
import { SqlitePersistenceMemory } from "./Sqlite.ts";

const layer = it.layer(
  Layer.mergeAll(ProjectionDispatchRepositoryLive, ProjectionTurnRepositoryLive).pipe(
    Layer.provideMerge(SqlitePersistenceMemory),
  ),
);

layer("ProjectionDispatchRepository", (it) => {
  it.effect("persists linkage and terminal state outside broker memory", () =>
    Effect.gen(function* () {
      const repository = yield* ProjectionDispatchRepository;
      const dispatchId = DispatchId.make("dispatch-persisted");
      const parentThreadId = ThreadId.make("parent-thread");
      const parentTurnId = TurnId.make("parent-turn");
      const childThreadId = ThreadId.make("child-thread");

      yield* repository.upsert({
        dispatchId,
        parentThreadId,
        parentTurnId,
        childThreadId,
        instanceId: ProviderInstanceId.make("claude-builder"),
        provider: ProviderDriverKind.make("claudeAgent"),
        model: "claude-opus-4-1",
        role: "build",
        title: "Build durable dispatches",
        effort: "high",
        status: "running",
        reason: null,
        summary: null,
        startedAt: "2026-08-11T12:00:00.000Z",
        settledAt: null,
      });
      yield* repository.upsert({
        dispatchId,
        parentThreadId,
        parentTurnId,
        childThreadId,
        instanceId: ProviderInstanceId.make("claude-builder"),
        provider: ProviderDriverKind.make("claudeAgent"),
        model: "claude-opus-4-1",
        role: "build",
        title: "Build durable dispatches",
        effort: "high",
        status: "completed",
        reason: null,
        summary: "Implemented",
        startedAt: "2026-08-11T12:00:00.000Z",
        settledAt: "2026-08-11T12:05:00.000Z",
      });

      const persisted = Option.getOrThrow(yield* repository.getById({ dispatchId }));
      assert.equal(persisted.status, "completed");
      assert.equal(persisted.summary, "Implemented");
      assert.equal(persisted.childThreadId, childThreadId);
      assert.equal((yield* repository.listUnsettled).length, 0);
      assert.deepStrictEqual(
        (yield* repository.listByParentTurn({ parentThreadId, parentTurnId })).map(
          (dispatch) => dispatch.dispatchId,
        ),
        [dispatchId],
      );
    }),
  );

  it.effect("carries the selected crew and test-flight overrides into the concrete turn", () =>
    Effect.gen(function* () {
      const turns = yield* ProjectionTurnRepository;
      const threadId = ThreadId.make("crew-thread");
      const turnId = TurnId.make("crew-turn");
      const crewId = CrewId.make("deep_build");
      const crewTestFlight = {
        seatOverrides: [{ instanceId: ProviderInstanceId.make("builder"), model: "gpt-5.6-mini" }],
      };

      yield* turns.replacePendingTurnStart({
        threadId,
        messageId: MessageId.make("crew-message"),
        crewId,
        crewTestFlight,
        sourceProposedPlanThreadId: null,
        sourceProposedPlanId: null,
        requestedAt: "2026-08-11T13:00:00.000Z",
      });
      const pending = Option.getOrThrow(yield* turns.getPendingTurnStartByThreadId({ threadId }));
      assert.equal(pending.crewId, crewId);
      assert.deepStrictEqual(pending.crewTestFlight, crewTestFlight);

      yield* turns.upsertByTurnId({
        threadId,
        turnId,
        pendingMessageId: pending.messageId,
        crewId: pending.crewId,
        crewTestFlight: pending.crewTestFlight,
        sourceProposedPlanThreadId: null,
        sourceProposedPlanId: null,
        assistantMessageId: null,
        state: "running",
        requestedAt: pending.requestedAt,
        startedAt: "2026-08-11T13:00:01.000Z",
        completedAt: null,
        checkpointTurnCount: null,
        checkpointRef: null,
        checkpointStatus: null,
        checkpointFiles: [],
      });
      assert.equal(
        Option.getOrThrow(yield* turns.getByTurnId({ threadId, turnId })).crewId,
        crewId,
      );
      assert.deepStrictEqual(
        Option.getOrThrow(yield* turns.getByTurnId({ threadId, turnId })).crewTestFlight,
        crewTestFlight,
      );
    }),
  );
});

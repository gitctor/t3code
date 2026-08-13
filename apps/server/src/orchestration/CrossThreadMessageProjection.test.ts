import { describe, expect, it } from "@effect/vitest";
import {
  CommandId,
  EnvironmentId,
  EventId,
  MessageId,
  ThreadId,
  TurnId,
  type OrchestrationEvent,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import {
  crossThreadMessageFromProjection,
  crossThreadMessageProjectionRow,
} from "./CrossThreadMessageProjection.ts";
import { ProjectionCrossThreadMessageRepositoryLive } from "../persistence/Layers/ProjectionCrossThreadMessages.ts";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import { ProjectionCrossThreadMessageRepository } from "../persistence/Services/ProjectionCrossThreadMessages.ts";

const message = {
  messageId: MessageId.make("message-1"),
  environmentId: EnvironmentId.make("environment-1"),
  sourceThreadId: ThreadId.make("thread-source"),
  sourceTurnId: TurnId.make("turn-source"),
  targetThreadId: ThreadId.make("thread-target"),
  body: "Please review the focused tests.",
  status: "queued" as const,
  createdAt: "2026-08-12T12:00:00.000Z",
};

function event(nextMessage: typeof message): OrchestrationEvent {
  return {
    type: "message.sent",
    sequence: 1,
    eventId: EventId.make("event-1"),
    aggregateKind: "message",
    aggregateId: nextMessage.messageId,
    occurredAt: nextMessage.createdAt,
    commandId: CommandId.make("command-1"),
    causationEventId: null,
    correlationId: null,
    metadata: {},
    payload: { message: nextMessage },
  } as OrchestrationEvent;
}

describe("crossThreadMessageProjectionRow", () => {
  it("maps optional lifecycle fields to nullable SQLite fields", () => {
    const row = crossThreadMessageProjectionRow(event(message) as never);
    expect(row).toEqual({
      ...message,
      reason: null,
      deliveredAt: null,
    });
    expect(crossThreadMessageFromProjection(row)).toEqual(message);
  });

  it.effect("persists FIFO queue order and lifecycle updates", () =>
    Effect.gen(function* () {
      const repository = yield* ProjectionCrossThreadMessageRepository;
      const second = {
        ...message,
        messageId: MessageId.make("message-2"),
        createdAt: "2026-08-12T12:00:01.000Z",
      };
      yield* repository.upsert(crossThreadMessageProjectionRow(event(second) as never));
      yield* repository.upsert(crossThreadMessageProjectionRow(event(message) as never));

      expect(
        (yield* repository.listQueuedByTarget({
          environmentId: message.environmentId,
          targetThreadId: message.targetThreadId,
        })).map((row) => row.messageId),
      ).toEqual([message.messageId, second.messageId]);

      const delivered = {
        ...message,
        status: "delivered" as const,
        deliveredAt: "2026-08-12T12:01:00.000Z",
      };
      yield* repository.upsert(
        crossThreadMessageProjectionRow({
          ...event(message),
          type: "message.delivered",
          payload: { message: delivered },
        } as never),
      );

      expect(
        (yield* repository.listQueuedByTarget({
          environmentId: message.environmentId,
          targetThreadId: message.targetThreadId,
        })).map((row) => row.messageId),
      ).toEqual([second.messageId]);
      expect(
        yield* repository.countBySourceTurn({
          environmentId: message.environmentId,
          sourceThreadId: message.sourceThreadId,
          sourceTurnId: message.sourceTurnId,
        }),
      ).toBe(2);
    }).pipe(
      Effect.provide(
        ProjectionCrossThreadMessageRepositoryLive.pipe(Layer.provide(SqlitePersistenceMemory)),
      ),
    ),
  );
});

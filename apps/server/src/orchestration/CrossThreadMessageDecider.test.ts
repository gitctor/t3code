import { assert, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { CommandId, EnvironmentId, MessageId, ThreadId, TurnId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { decideOrchestrationCommand } from "./decider.ts";

const createdAt = "2026-08-12T12:00:00.000Z";
const message = {
  messageId: MessageId.make("message-1"),
  environmentId: EnvironmentId.make("environment-1"),
  sourceThreadId: ThreadId.make("thread-source"),
  sourceTurnId: TurnId.make("turn-source"),
  targetThreadId: ThreadId.make("thread-target"),
  body: "Please review the focused tests.",
  status: "queued" as const,
  createdAt,
};

const readModel = {
  snapshotSequence: 0,
  updatedAt: createdAt,
  projects: [],
  threads: [],
};

it.effect("emits the cross-thread message lifecycle through the decider", () =>
  Effect.gen(function* () {
    const sent = yield* decideOrchestrationCommand({
      command: {
        type: "message.send",
        commandId: CommandId.make("command-send"),
        message,
      },
      readModel,
    });
    if (!("type" in sent)) return assert.fail("expected message.sent event");
    assert.equal(sent.type, "message.sent");
    assert.equal(sent.aggregateKind, "message");
    assert.equal(sent.aggregateId, message.messageId);

    const deliveredMessage = {
      ...message,
      status: "delivered" as const,
      deliveredAt: "2026-08-12T12:01:00.000Z",
    };
    const delivered = yield* decideOrchestrationCommand({
      command: {
        type: "message.deliver",
        commandId: CommandId.make("command-deliver"),
        message: deliveredMessage,
      },
      readModel,
    });
    if (!("type" in delivered)) return assert.fail("expected message.delivered event");
    assert.equal(delivered.type, "message.delivered");
    assert.deepEqual(delivered.payload, { message: deliveredMessage });

    const rejectedMessage = {
      ...message,
      status: "rejected" as const,
      reason: "Target is outside the allowed messaging scope.",
    };
    const rejected = yield* decideOrchestrationCommand({
      command: {
        type: "message.reject",
        commandId: CommandId.make("command-reject"),
        message: rejectedMessage,
      },
      readModel,
    });
    if (!("type" in rejected)) return assert.fail("expected message.rejected event");
    assert.equal(rejected.type, "message.rejected");
    assert.deepEqual(rejected.payload, { message: rejectedMessage });
  }).pipe(Effect.provide(NodeServices.layer)),
);

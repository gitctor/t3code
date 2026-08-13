import {
  CommandId,
  EventId,
  MessageId,
  providerSupportsActiveTurnSteer,
  type ThreadMessage,
} from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { crossThreadMessageFromProjection } from "../orchestration/CrossThreadMessageProjection.ts";
import { ProjectionCrossThreadMessageRepository } from "../persistence/Services/ProjectionCrossThreadMessages.ts";
import { ProjectionTurnRepository } from "../persistence/Services/ProjectionTurns.ts";
import { ProviderInstanceRegistry } from "../provider/Services/ProviderInstanceRegistry.ts";
import { CrossThreadMessageDeliveryLock } from "./CrossThreadMessageDeliveryLock.ts";

export function crossThreadMessageEnvelope(input: {
  readonly sourceTitle: string;
  readonly sourceThreadId: string;
  readonly body: string;
}): string {
  return `[Message from thread ${input.sourceTitle} (${input.sourceThreadId})]:\n${input.body}`;
}

export const makeCrossThreadMessageDelivery = Effect.gen(function* () {
  const crypto = yield* Crypto.Crypto;
  const engine = yield* OrchestrationEngineService;
  const snapshots = yield* ProjectionSnapshotQuery;
  const messages = yield* ProjectionCrossThreadMessageRepository;
  const turns = yield* ProjectionTurnRepository;
  const instances = yield* ProviderInstanceRegistry;
  const deliveryLock = yield* CrossThreadMessageDeliveryLock;
  const deliverUnlocked = Effect.fn("deliverCrossThreadMessage.unlocked")(function* (
    requestedMessage: ThreadMessage,
  ) {
    const persisted = Option.getOrUndefined(
      yield* messages.getById({ messageId: requestedMessage.messageId }),
    );
    if (!persisted || persisted.status !== "queued") {
      return false;
    }
    const queue = yield* messages.listQueuedByTarget({
      environmentId: persisted.environmentId,
      targetThreadId: persisted.targetThreadId,
    });
    if (queue[0]?.messageId !== persisted.messageId) {
      return false;
    }
    const message = crossThreadMessageFromProjection(persisted);
    const [sourceOption, targetOption] = yield* Effect.all([
      snapshots.getThreadDetailById(message.sourceThreadId),
      snapshots.getThreadDetailById(message.targetThreadId),
    ]);
    const source = Option.getOrUndefined(sourceOption);
    const target = Option.getOrUndefined(targetOption);
    if (!source || !target) {
      return false;
    }

    const pendingTurnStart = Option.getOrUndefined(
      yield* turns.getPendingTurnStartByThreadId({ threadId: target.id }),
    );
    if (pendingTurnStart && pendingTurnStart.messageId !== message.messageId) {
      return false;
    }

    const targetRunning =
      target.latestTurn?.state === "running" ||
      target.session?.status === "starting" ||
      target.session?.status === "running";
    if (targetRunning) {
      const instance = yield* instances.getInstance(target.modelSelection.instanceId);
      if (!providerSupportsActiveTurnSteer(instance?.driverKind)) {
        return false;
      }
    }

    const deliveredAt = DateTime.formatIso(yield* DateTime.now);
    const envelope = crossThreadMessageEnvelope({
      sourceTitle: source.title,
      sourceThreadId: message.sourceThreadId,
      body: message.body,
    });
    const commandId = (suffix: string) =>
      CommandId.make(`server:cross-thread-message:${message.messageId}:${suffix}`);

    yield* engine.dispatch({
      type: "thread.turn.start",
      commandId: commandId("turn-start"),
      threadId: target.id,
      message: {
        messageId: message.messageId,
        role: "user",
        text: envelope,
        attachments: [],
      },
      modelSelection: target.modelSelection,
      runtimeMode: target.runtimeMode,
      interactionMode: target.interactionMode,
      ...(target.latestTurn?.crewId !== undefined ? { crewId: target.latestTurn.crewId } : {}),
      createdAt: deliveredAt,
    });

    yield* engine.dispatch({
      type: "thread.message.system.append",
      commandId: commandId("target-audit"),
      threadId: target.id,
      messageId: MessageId.make(`cross-thread-audit:${message.messageId}`),
      text: `Message from ${source.title}`,
      turnId: null,
      createdAt: deliveredAt,
      crossThreadSource: {
        messageId: message.messageId,
        sourceThreadId: source.id,
        sourceThreadTitle: source.title,
      },
    });

    yield* engine.dispatch({
      type: "thread.activity.append",
      commandId: commandId("source-activity"),
      threadId: source.id,
      activity: {
        id: EventId.make(yield* crypto.randomUUIDv4.pipe(Effect.orDie)),
        tone: "tool",
        kind: "task.progress",
        summary: `Sent message to ${target.title}`,
        payload: {
          taskId: `cross-thread-message:${message.messageId}`,
          description: `Message ${target.title}`,
          summary: `Delivered to ${target.title}`,
          targetThreadId: target.id,
          timelineBypass: true,
        },
        turnId: message.sourceTurnId,
        createdAt: deliveredAt,
      },
      createdAt: deliveredAt,
    });

    const delivered = {
      ...message,
      status: "delivered" as const,
      deliveredAt,
    };
    yield* engine.dispatch({
      type: "message.deliver",
      commandId: commandId("delivered"),
      message: delivered,
    });
    return delivered;
  });
  return Effect.fn("deliverCrossThreadMessage")((message: ThreadMessage) =>
    deliveryLock.withTargetLock(message.targetThreadId, deliverUnlocked(message)),
  );
});

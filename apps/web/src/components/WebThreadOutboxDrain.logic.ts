import {
  isAtomCommandInterrupted,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";

import type { QueuedWebThreadMessage } from "../webThreadOutbox";

export function buildQueuedWebThreadTurnStartInput(
  message: QueuedWebThreadMessage,
  titleSeed: string,
) {
  return {
    commandId: message.commandId,
    threadId: message.threadId,
    message: {
      messageId: message.messageId,
      role: "user" as const,
      text: message.text,
      attachments: message.attachments,
    },
    modelSelection: message.modelSelection,
    titleSeed,
    runtimeMode: message.runtimeMode,
    interactionMode: message.interactionMode,
    ...(message.crewId ? { crewId: message.crewId } : {}),
    createdAt: message.createdAt,
  };
}

/** The immediate path uses the same durable payload, but bypasses drain timing. */
export function buildPromotedQueuedWebThreadTurnStartInput(
  message: QueuedWebThreadMessage,
  titleSeed: string,
) {
  return buildQueuedWebThreadTurnStartInput(message, titleSeed);
}

export function shouldPauseWebThreadOutboxDelivery(
  result: AtomCommandResult<unknown, unknown>,
): boolean {
  return result._tag === "Failure" && !isAtomCommandInterrupted(result);
}

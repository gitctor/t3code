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

export function shouldPauseWebThreadOutboxDelivery(
  result: AtomCommandResult<unknown, unknown>,
): boolean {
  return result._tag === "Failure" && !isAtomCommandInterrupted(result);
}

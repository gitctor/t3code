import * as Schema from "effect/Schema";

import {
  CommandId,
  EnvironmentId,
  ForwardCompatibleArray,
  IsoDateTime,
  MessageId,
  ThreadId,
  TrimmedNonEmptyString,
  TurnId,
} from "./baseSchemas.ts";
import { ProviderDriverKind } from "./providerInstance.ts";

export const CrossThreadMessagingLevel = Schema.Literals(["off", "crew", "project"]);
export type CrossThreadMessagingLevel = typeof CrossThreadMessagingLevel.Type;
export const DEFAULT_CROSS_THREAD_MESSAGING_LEVEL: CrossThreadMessagingLevel = "off";

export const ThreadMessageBody = TrimmedNonEmptyString.check(Schema.isMaxLength(20_000));
export const ThreadMessageReason = TrimmedNonEmptyString.check(Schema.isMaxLength(1_000));

export const ThreadMessageStatus = Schema.Literals(["delivered", "queued", "rejected"]);
export type ThreadMessageStatus = typeof ThreadMessageStatus.Type;

/** Durable cross-thread input sent by one active agent turn. */
export const ThreadMessage = Schema.Struct({
  messageId: MessageId,
  environmentId: EnvironmentId,
  sourceThreadId: ThreadId,
  sourceTurnId: TurnId,
  targetThreadId: ThreadId,
  body: ThreadMessageBody,
  status: ThreadMessageStatus,
  reason: Schema.optionalKey(ThreadMessageReason),
  createdAt: IsoDateTime,
  deliveredAt: Schema.optionalKey(IsoDateTime),
});
export type ThreadMessage = typeof ThreadMessage.Type;

export const ThreadMessages = ForwardCompatibleArray(ThreadMessage);
export type ThreadMessages = typeof ThreadMessages.Type;

/** Server-owned attribution attached only to cross-thread transcript audit lines. */
export const CrossThreadTranscriptSource = Schema.Struct({
  messageId: MessageId,
  sourceThreadId: ThreadId,
  sourceThreadTitle: TrimmedNonEmptyString,
});
export type CrossThreadTranscriptSource = typeof CrossThreadTranscriptSource.Type;

export const MessageableThread = Schema.Struct({
  id: ThreadId,
  title: TrimmedNonEmptyString,
  provider: ProviderDriverKind,
  state: Schema.Literals(["running", "idle"]),
});
export type MessageableThread = typeof MessageableThread.Type;
export const MessageableThreads = ForwardCompatibleArray(MessageableThread);

export const ListMessageableThreadsInput = Schema.Struct({});
export type ListMessageableThreadsInput = typeof ListMessageableThreadsInput.Type;
export const ListMessageableThreadsResult = Schema.Struct({ threads: MessageableThreads });
export type ListMessageableThreadsResult = typeof ListMessageableThreadsResult.Type;

/** Agent-authored fields. Attribution, source identity, ids, and lifecycle are server-owned. */
export const SendToThreadInput = Schema.Struct({
  targetThreadId: ThreadId,
  body: ThreadMessageBody,
});
export type SendToThreadInput = typeof SendToThreadInput.Type;
export const SendToThreadResult = Schema.Struct({ message: ThreadMessage });
export type SendToThreadResult = typeof SendToThreadResult.Type;

export const ThreadMessagingErrorCode = Schema.Literals([
  "capability-unavailable",
  "source-turn-unavailable",
  "target-not-found",
  "scope-violation",
  "cross-environment",
  "rate-limit-reached",
  "delivery-failed",
]);
export type ThreadMessagingErrorCode = typeof ThreadMessagingErrorCode.Type;

export class ThreadMessagingError extends Schema.ErrorClass<ThreadMessagingError>(
  "ThreadMessagingError",
)({
  code: ThreadMessagingErrorCode,
  message: TrimmedNonEmptyString,
}) {}

export const ThreadMessageSendCommand = Schema.Struct({
  type: Schema.Literal("message.send"),
  commandId: CommandId,
  message: ThreadMessage,
});
export type ThreadMessageSendCommand = typeof ThreadMessageSendCommand.Type;

export const ThreadMessageDeliverCommand = Schema.Struct({
  type: Schema.Literal("message.deliver"),
  commandId: CommandId,
  message: ThreadMessage,
});
export type ThreadMessageDeliverCommand = typeof ThreadMessageDeliverCommand.Type;

export const ThreadMessageRejectCommand = Schema.Struct({
  type: Schema.Literal("message.reject"),
  commandId: CommandId,
  message: ThreadMessage,
});
export type ThreadMessageRejectCommand = typeof ThreadMessageRejectCommand.Type;

export const CrossThreadMessageSentPayload = Schema.Struct({ message: ThreadMessage });
export const CrossThreadMessageDeliveredPayload = Schema.Struct({ message: ThreadMessage });
export const CrossThreadMessageRejectedPayload = Schema.Struct({ message: ThreadMessage });

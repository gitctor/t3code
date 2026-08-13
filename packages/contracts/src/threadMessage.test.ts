import { describe, expect, it } from "@effect/vitest";
import * as Schema from "effect/Schema";

import {
  SendToThreadInput,
  ThreadMessage,
  ThreadMessageSendCommand,
  ThreadMessages,
} from "./threadMessage.ts";

const message = {
  messageId: "message-1",
  environmentId: "environment-1",
  sourceThreadId: "thread-source",
  sourceTurnId: "turn-source",
  targetThreadId: "thread-target",
  body: "Review the projection tests.",
  status: "queued",
  createdAt: "2026-08-12T12:00:00.000Z",
} as const;
const decodeThreadMessage = Schema.decodeUnknownSync(ThreadMessage);
const encodeThreadMessage = Schema.encodeSync(ThreadMessage);
const decodeThreadMessageCommand = Schema.decodeUnknownSync(ThreadMessageSendCommand);
const encodeThreadMessageCommand = Schema.encodeSync(ThreadMessageSendCommand);
const decodeThreadMessages = Schema.decodeUnknownSync(ThreadMessages);
const decodeSendToThreadInput = Schema.decodeUnknownSync(SendToThreadInput);

describe("ThreadMessage contracts", () => {
  it("round-trips the record and lifecycle command", () => {
    const decoded = decodeThreadMessage(message);

    expect(decodeThreadMessage(encodeThreadMessage(decoded))).toEqual(message);

    const command = {
      type: "message.send",
      commandId: "command-1",
      message,
    } as const;
    expect(
      decodeThreadMessageCommand(encodeThreadMessageCommand(decodeThreadMessageCommand(command))),
    ).toEqual(command);
  });

  it("keeps forward fields and isolates malformed array entries", () => {
    const decoded = decodeThreadMessages([
      { ...message, futureReceipt: "visible" },
      { ...message, messageId: "message-2", body: "x".repeat(20_001) },
    ]);

    expect(decoded).toEqual([message]);
  });

  it("enforces the 20k body limit on records and tool input", () => {
    expect(() => decodeThreadMessage({ ...message, body: "x".repeat(20_001) })).toThrow();
    expect(() =>
      decodeSendToThreadInput({
        targetThreadId: "thread-target",
        body: "x".repeat(20_001),
      }),
    ).toThrow();
  });
});

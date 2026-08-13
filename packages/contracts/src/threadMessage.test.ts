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

describe("ThreadMessage contracts", () => {
  it("round-trips the record and lifecycle command", () => {
    const decodeMessage = Schema.decodeUnknownSync(ThreadMessage);
    const encodeMessage = Schema.encodeSync(ThreadMessage);
    const decoded = decodeMessage(message);

    expect(decodeMessage(encodeMessage(decoded))).toEqual(message);

    const command = {
      type: "message.send",
      commandId: "command-1",
      message,
    } as const;
    const decodeCommand = Schema.decodeUnknownSync(ThreadMessageSendCommand);
    const encodeCommand = Schema.encodeSync(ThreadMessageSendCommand);
    expect(decodeCommand(encodeCommand(decodeCommand(command)))).toEqual(command);
  });

  it("keeps forward fields and isolates malformed array entries", () => {
    const decoded = Schema.decodeUnknownSync(ThreadMessages)([
      { ...message, futureReceipt: "visible" },
      { ...message, messageId: "message-2", body: "x".repeat(20_001) },
    ]);

    expect(decoded).toEqual([message]);
  });

  it("enforces the 20k body limit on records and tool input", () => {
    expect(() =>
      Schema.decodeUnknownSync(ThreadMessage)({ ...message, body: "x".repeat(20_001) }),
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(SendToThreadInput)({
        targetThreadId: "thread-target",
        body: "x".repeat(20_001),
      }),
    ).toThrow();
  });
});

import {
  CommandId,
  CrewId,
  EnvironmentId,
  MessageId,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/unstable/reactivity";
import { describe, expect, it } from "vite-plus/test";

import {
  buildQueuedWebThreadTurnStartInput,
  shouldPauseWebThreadOutboxDelivery,
} from "./WebThreadOutboxDrain.logic";

const queuedPlannerMessage = {
  environmentId: EnvironmentId.make("environment-planner"),
  threadId: ThreadId.make("thread-planner"),
  messageId: MessageId.make("message-planner"),
  commandId: CommandId.make("command-planner"),
  text: "Continue the crew plan.",
  attachments: [],
  modelSelection: {
    instanceId: ProviderInstanceId.make("kimi"),
    model: "kimi-for-coding",
  },
  runtimeMode: "full-access" as const,
  interactionMode: "default" as const,
  activeTurnMessageBehavior: "queue" as const,
  crewId: CrewId.make("orchestrator"),
  createdAt: "2026-08-12T19:00:00.000Z",
};

describe("buildQueuedWebThreadTurnStartInput", () => {
  it("keeps the planner thread and crew identity", () => {
    const input = buildQueuedWebThreadTurnStartInput(queuedPlannerMessage, "Planner");

    expect(input.threadId).toBe(queuedPlannerMessage.threadId);
    expect(input.crewId).toBe(queuedPlannerMessage.crewId);
    expect(input.message.text).toBe(queuedPlannerMessage.text);
  });
});

describe("shouldPauseWebThreadOutboxDelivery", () => {
  it("defers interrupted commands so reconnect can retry them", () => {
    expect(shouldPauseWebThreadOutboxDelivery(AsyncResult.failure(Cause.interrupt(1)))).toBe(false);
  });

  it("pauses definitive command failures", () => {
    expect(
      shouldPauseWebThreadOutboxDelivery(
        AsyncResult.failure(Cause.fail(new Error("provider rejected the turn"))),
      ),
    ).toBe(true);
  });

  it("does not pause successful commands", () => {
    expect(shouldPauseWebThreadOutboxDelivery(AsyncResult.success(undefined))).toBe(false);
  });
});

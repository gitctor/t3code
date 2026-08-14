import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import {
  Crew,
  CrewId,
  DispatchInput,
  DispatchRecord,
  ResolvedCrew,
  CrewTestFlightTurnInput,
  isRunnableCrew,
  isSettledDispatchStatus,
} from "./orchestrationCrew.ts";
import { ThreadTurnStartCommand } from "./orchestration.ts";
import { TaskAgentLinkage } from "./providerRuntime.ts";

const decodeCrewId = Schema.decodeUnknownSync(CrewId);
const decodeCrew = Schema.decodeUnknownSync(Crew);
const decodeDispatchRecord = Schema.decodeUnknownSync(DispatchRecord);
const decodeResolvedCrew = Schema.decodeUnknownSync(ResolvedCrew);
const decodeTestFlightTurnInput = Schema.decodeUnknownSync(CrewTestFlightTurnInput);

const deepBuild = {
  id: "deep_build",
  name: "Deep Build",
  planner: {
    instanceId: "claudeAgent",
    model: "claude-fable-5",
    options: [{ id: "effort", value: "xhigh" }],
  },
  members: [
    { instanceId: "codex", model: "gpt-5.6-sol", role: "build" },
    { instanceId: "kimi", role: "design" },
  ],
};

describe("CrewId", () => {
  it.each(["deep_build", "ship-it", "a", "crew123"])("accepts %s", (id) => {
    expect(decodeCrewId(id)).toBe(id);
  });

  it.each(["", "1crew", "-crew", "has space", "emoji✨"])("rejects %s", (id) => {
    expect(() => decodeCrewId(id)).toThrow();
  });
});

describe("Crew", () => {
  it("round-trips a full crew", () => {
    const crew = decodeCrew(deepBuild);
    expect(crew.planner.model).toBe("claude-fable-5");
    expect(crew.members).toHaveLength(2);
  });

  it("keeps a member with no model — instance default is a valid answer", () => {
    const crew = decodeCrew(deepBuild);
    expect(crew.members[1]?.model).toBeUndefined();
    expect(crew.members[1]?.role).toBe("design");
  });

  it("requires a planner model — an unrunnable crew fails at the boundary", () => {
    expect(() => decodeCrew({ ...deepBuild, planner: { instanceId: "claudeAgent" } })).toThrow();
  });

  it("drops only the malformed member, keeping the rest of the roster", () => {
    const crew = decodeCrew({
      ...deepBuild,
      members: [{ instanceId: "codex" }, { instanceId: "" }, { instanceId: "kimi" }],
    });
    expect(crew.members.map((m) => m.instanceId)).toEqual(["codex", "kimi"]);
  });
});

describe("dispatch lifecycle", () => {
  it.each(["completed", "failed", "declined", "cancelled"] as const)("%s is settled", (status) => {
    expect(isSettledDispatchStatus(status)).toBe(true);
  });

  it.each(["queued", "running"] as const)("%s is not settled", (status) => {
    expect(isSettledDispatchStatus(status)).toBe(false);
  });

  it("allows a declined dispatch to carry no child thread", () => {
    const record = decodeDispatchRecord({
      dispatchId: "d1",
      parentThreadId: "t1",
      parentTurnId: "turn1",
      instanceId: "kimi",
      status: "declined",
      reason: "Kimi instance is not available",
      startedAt: "2026-08-11T23:00:00.000Z",
      settledAt: "2026-08-11T23:00:00.000Z",
    });
    expect(record.childThreadId).toBeUndefined();
    expect(isSettledDispatchStatus(record.status)).toBe(true);
  });
});

describe("cross-cutting contract additions", () => {
  const decodeTurnStart = Schema.decodeUnknownSync(ThreadTurnStartCommand);
  const decodeLinkage = Schema.decodeUnknownSync(TaskAgentLinkage);
  const decodeDispatchInput = Schema.decodeUnknownSync(DispatchInput);

  const baseTurnStart = {
    type: "thread.turn.start",
    commandId: "c1",
    threadId: "t1",
    message: { messageId: "m1", role: "user", text: "go", attachments: [] },
    createdAt: "2026-08-11T23:00:00.000Z",
  };

  it("turn start decodes without a crewId — every existing payload is unchanged", () => {
    expect(decodeTurnStart(baseTurnStart).crewId).toBeUndefined();
  });

  it("turn start carries a crewId when the composer starts an orchestrated turn", () => {
    expect(decodeTurnStart({ ...baseTurnStart, crewId: "deep_build" }).crewId).toBe("deep_build");
  });

  it("task linkage carries dispatch identity, and legacy rows decode without it", () => {
    expect(decodeLinkage({})).toEqual({});
    const linked = decodeLinkage({ instanceId: "kimi", childThreadId: "t9" });
    expect(linked.instanceId).toBe("kimi");
    expect(linked.childThreadId).toBe("t9");
  });

  it("dispatch input chains onto a prior dispatch via fromDispatchId", () => {
    const input = decodeDispatchInput({
      instanceId: "claudeAgent",
      prompt: "review the builder's diff",
      fromDispatchId: "d1",
    });
    expect(input.fromDispatchId).toBe("d1");
  });
});

describe("isRunnableCrew", () => {
  const resolve = (plannerAvailable: boolean, availableMemberIds: ReadonlyArray<string>) =>
    decodeResolvedCrew({ crew: deepBuild, plannerAvailable, availableMemberIds });

  it("runs when the planner and at least one member resolve", () => {
    expect(isRunnableCrew(resolve(true, ["codex"]))).toBe(true);
  });

  it("does not run without a planner", () => {
    expect(isRunnableCrew(resolve(false, ["codex", "kimi"]))).toBe(false);
  });

  it("does not run with nobody to dispatch to", () => {
    expect(isRunnableCrew(resolve(true, []))).toBe(false);
  });
});

describe("CrewTestFlightTurnInput", () => {
  it("decodes frozen per-seat model overrides without changing the saved crew", () => {
    const input = decodeTestFlightTurnInput({
      seatOverrides: [
        { instanceId: "codex", model: "gpt-5.6-mini" },
        { instanceId: "kimi", model: "kimi-code/kimi-for-coding-highspeed" },
      ],
    });

    expect(input.seatOverrides).toEqual([
      { instanceId: "codex", model: "gpt-5.6-mini" },
      { instanceId: "kimi", model: "kimi-code/kimi-for-coding-highspeed" },
    ]);
    expect(deepBuild.members[0]?.model).toBe("gpt-5.6-sol");
  });
});

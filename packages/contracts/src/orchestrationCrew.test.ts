import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import {
  Crew,
  CrewId,
  DispatchRecord,
  ResolvedCrew,
  isRunnableCrew,
  isSettledDispatchStatus,
} from "./orchestrationCrew.ts";

const decodeCrewId = Schema.decodeUnknownSync(CrewId);
const decodeCrew = Schema.decodeUnknownSync(Crew);
const decodeDispatchRecord = Schema.decodeUnknownSync(DispatchRecord);
const decodeResolvedCrew = Schema.decodeUnknownSync(ResolvedCrew);

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

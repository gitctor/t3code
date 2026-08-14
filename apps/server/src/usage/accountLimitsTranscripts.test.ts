// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { afterEach, describe, expect, it } from "@effect/vitest";

import { readLatestLoggedAccountLimits } from "./accountLimitsTranscripts.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => NodeFSP.rm(directory, { recursive: true, force: true })),
  );
});

function canonicalRateLimitEvent(input: {
  readonly provider: string;
  readonly createdAt: string;
  readonly usedPercent: number;
}): string {
  return `[${input.createdAt}] CANON: ${JSON.stringify({
    type: "account.rate-limits.updated",
    provider: input.provider,
    createdAt: input.createdAt,
    payload: { rateLimits: { used_percent: input.usedPercent } },
  })}`;
}

describe("readLatestLoggedAccountLimits", () => {
  it("recovers the newest canonical record per provider from per-thread rotations", async () => {
    const directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-limits-"));
    temporaryDirectories.push(directory);
    const basePath = NodePath.join(directory, "events.log");
    await NodeFSP.writeFile(
      NodePath.join(directory, "events.thread-a.log.1"),
      [
        canonicalRateLimitEvent({
          provider: "claudeAgent",
          createdAt: "2026-08-12T10:00:00.000Z",
          usedPercent: 20,
        }),
        canonicalRateLimitEvent({
          provider: "codex",
          createdAt: "2026-08-12T11:00:00.000Z",
          usedPercent: 30,
        }),
      ].join("\n"),
    );
    await NodeFSP.writeFile(
      NodePath.join(directory, "events.thread-b.log"),
      canonicalRateLimitEvent({
        provider: "claudeAgent",
        createdAt: "2026-08-13T12:00:00.000Z",
        usedPercent: 45,
      }),
    );

    const records = await readLatestLoggedAccountLimits(
      basePath,
      Date.parse("2026-08-13T13:00:00.000Z"),
    );

    expect(records).toHaveLength(2);
    expect(records.find((record) => record.provider === "claudeAgent")).toEqual({
      provider: "claudeAgent",
      createdAt: "2026-08-13T12:00:00.000Z",
      payload: { used_percent: 45 },
    });
    expect(records.find((record) => record.provider === "codex")?.createdAt).toBe(
      "2026-08-12T11:00:00.000Z",
    );
  });

  it("ignores native and unrelated canonical records", async () => {
    const directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-limits-"));
    temporaryDirectories.push(directory);
    await NodeFSP.writeFile(
      NodePath.join(directory, "events.thread.log"),
      [
        `[2026-08-13T12:00:00.000Z] NTIVE: ${JSON.stringify({ type: "rate_limit_event" })}`,
        `[2026-08-13T12:00:00.000Z] CANON: ${JSON.stringify({ type: "turn.completed" })}`,
      ].join("\n"),
    );

    await expect(
      readLatestLoggedAccountLimits(
        NodePath.join(directory, "events.log"),
        Date.parse("2026-08-13T13:00:00.000Z"),
      ),
    ).resolves.toEqual([]);
  });
});

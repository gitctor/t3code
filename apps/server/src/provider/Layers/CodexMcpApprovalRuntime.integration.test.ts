// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { CrewId, ThreadId } from "@t3tools/contracts";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Stream from "effect/Stream";
import { assert, describe } from "vite-plus/test";

import { makeCodexSessionRuntime } from "./CodexSessionRuntime.ts";

const peerPath = NodePath.join(import.meta.dirname, "../testFixtures/codexMcpApprovalMockPeer.sh");

describe("CodexSessionRuntime crew MCP approvals", () => {
  it.live("accepts test-flight dispatch while leaving non-orchestration MCP supervised", () =>
    Effect.gen(function* () {
      const responsesPath = NodePath.join(
        NodeOS.tmpdir(),
        `t3-codex-mcp-approval-${process.pid}.ndjson`,
      );
      NodeFS.rmSync(responsesPath, { force: true });
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => NodeFS.rmSync(responsesPath, { force: true })),
      );

      const runtime = yield* makeCodexSessionRuntime({
        threadId: ThreadId.make("thread-codex-mcp-approval"),
        binaryPath: peerPath,
        cwd: "/tmp",
        runtimeMode: "approval-required",
        environment: {
          ...process.env,
          T3_CODEX_MCP_APPROVAL_RESPONSES: responsesPath,
        },
        shouldAutoApproveMcpToolCall: (serverName, toolName) =>
          serverName === "t3-code" &&
          (toolName === "dispatch" ||
            toolName === "await_dispatch" ||
            toolName === "list_dispatches"),
      });

      const eventsFiber = yield* runtime.events.pipe(
        Stream.tap((event) => {
          if (event.kind !== "request" || event.method !== "item/tool/requestUserInput") {
            return Effect.void;
          }
          if (event.requestId === undefined) {
            return Effect.die("Codex user-input request was missing its request id");
          }
          const payload = event.payload as { questions: ReadonlyArray<{ id: string }> };
          return runtime.respondToUserInput(event.requestId, {
            [payload.questions[0]?.id ?? "missing-question"]: "Cancel",
          });
        }),
        Stream.takeUntil((event) => event.method === "turn/completed"),
        Stream.runCollect,
        Effect.forkScoped,
      );

      yield* runtime.start();
      yield* runtime.sendTurn({
        input: "Run the crew test flight",
        crewId: CrewId.make("orchestrator"),
      });
      const events = Array.from(yield* Fiber.join(eventsFiber));
      const approvalRequests = events.filter(
        (event) => event.kind === "request" && event.method === "item/tool/requestUserInput",
      );
      assert.lengthOf(approvalRequests, 1);
      assert.equal(String(approvalRequests[0]?.itemId), "mcp-preview-approval");

      const dispatchLifecycle = events.filter(
        (event) =>
          (event.method === "item/started" || event.method === "item/completed") &&
          String(event.itemId) === "mcp-dispatch-approval",
      );
      assert.deepEqual(
        dispatchLifecycle.map((event) => event.method),
        ["item/started", "item/completed"],
      );

      const responses = NodeFS.readFileSync(responsesPath, "utf8")
        .trim()
        .split("\n")
        .map(
          (line) =>
            JSON.parse(line) as {
              id: number;
              method?: string;
              params?: { approvalPolicy?: string; sandboxPolicy?: unknown };
              result?: { answers: unknown };
            },
        );
      const turnStartRequest = responses.find((response) => response.method === "turn/start");
      assert.equal(turnStartRequest?.params?.approvalPolicy, "on-request");
      assert.deepEqual(turnStartRequest?.params?.sandboxPolicy, { type: "readOnly" });
      assert.deepEqual(responses.find((response) => response.id === 101)?.result?.answers, {
        "mcp_tool_call_approval_mcp-dispatch-approval": { answers: ["Allow"] },
      });
      assert.deepEqual(responses.find((response) => response.id === 102)?.result?.answers, {
        "mcp_tool_call_approval_mcp-preview-approval": { answers: ["Cancel"] },
      });

      yield* runtime.close;
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});

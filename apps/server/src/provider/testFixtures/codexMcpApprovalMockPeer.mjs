// Minimal Codex app-server peer for the crew MCP approval regression.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeReadline from "node:readline";
import * as NodeURL from "node:url";

const here = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));
const fixture = JSON.parse(
  NodeFS.readFileSync(NodePath.join(here, "codexMultiAgentWire.json"), "utf8"),
);
const responsesPath = process.env.T3_CODEX_MCP_APPROVAL_RESPONSES;
const threadId = fixture.rootThreadId;
const turn = { ...fixture.responses.turnStart.turn, id: "turn-mcp-approval" };
const dispatchItem = {
  type: "mcpToolCall",
  id: "mcp-dispatch-approval",
  server: "t3-code",
  tool: "dispatch",
  arguments: { task: "Run the accepted test-flight dispatch" },
  status: "inProgress",
};
const previewItem = {
  type: "mcpToolCall",
  id: "mcp-preview-approval",
  server: "t3-code",
  tool: "preview_open",
  arguments: { url: "/settings" },
  status: "inProgress",
};
const question = (itemId) => ({
  header: "MCP tool",
  id: `mcp_tool_call_approval_${itemId}`,
  question: "Allow this MCP tool call?",
  options: [
    { label: "Allow", description: "Run the tool" },
    { label: "Cancel", description: "Reject the tool" },
  ],
});
const write = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
const requestApproval = (id, item) =>
  write({
    jsonrpc: "2.0",
    id,
    method: "item/tool/requestUserInput",
    params: {
      threadId,
      turnId: turn.id,
      itemId: item.id,
      questions: [question(item.id)],
    },
  });
const startItem = (item) =>
  write({
    jsonrpc: "2.0",
    method: "item/started",
    params: { threadId, turnId: turn.id, startedAtMs: 1, item },
  });

const rl = NodeReadline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  const { id, method } = message;
  if (method === undefined && (id === 101 || id === 102)) {
    NodeFS.appendFileSync(responsesPath, `${JSON.stringify(message)}\n`);
    if (id === 101) {
      write({
        jsonrpc: "2.0",
        method: "item/completed",
        params: {
          threadId,
          turnId: turn.id,
          completedAtMs: 2,
          item: { ...dispatchItem, status: "completed", durationMs: 1 },
        },
      });
      startItem(previewItem);
      requestApproval(102, previewItem);
    } else {
      write({
        jsonrpc: "2.0",
        method: "turn/completed",
        params: { threadId, turn: { ...turn, status: "completed" } },
      });
    }
    return;
  }
  if (method === "initialize") {
    write({
      id,
      result: {
        userAgent: "t3-mcp-approval-mock/0.0.0",
        codexHome: "/tmp",
        platformFamily: "unix",
        platformOs: "linux",
      },
    });
    return;
  }
  if (method === "thread/start" || method === "thread/resume") {
    write({ id, result: fixture.responses.threadStart });
    return;
  }
  if (method === "turn/start") {
    write({ id, result: { ...fixture.responses.turnStart, turn } });
    write({ jsonrpc: "2.0", method: "turn/started", params: { threadId, turn } });
    startItem(dispatchItem);
    requestApproval(101, dispatchItem);
    return;
  }
  if (id !== undefined) {
    write({ id, result: {} });
  }
});
